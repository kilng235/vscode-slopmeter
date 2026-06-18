import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as vscode from 'vscode'
import { IProvider } from './types'
import {
  UsageSummary, ProviderId, TokenTotals,
  DailyUsage, ModelUsage, Insights
} from '../models'
import { formatDate, computeLongestStreak, computeCurrentStreak } from '../utils'
import { findHermesDir, tryMtime } from '../platform/paths'
import { findPython, isPythonAvailable } from '../platform/python'

interface HermesSession {
  id: string
  model: string
  started_at: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  reasoning_tokens: number
  message_count: number
}

export class HermesProvider implements IProvider {
  id: ProviderId = 'hermes'
  name = 'Hermes Agent'

  private extensionUri?: string

  constructor(private customPath?: string, extensionUri?: string) {
    this.extensionUri = extensionUri
  }

  private getBaseDir(): string {
    if (this.customPath) return this.customPath
    const dir = findHermesDir()
    return dir || path.join(os.homedir(), '.hermes')
  }

  isAvailable(): boolean {
    try {
      const baseDir = this.getBaseDir()
      if (!fs.existsSync(baseDir)) return false
      const dbPath = path.join(baseDir, 'state.db')
      return fs.existsSync(dbPath)
    } catch {
      return false
    }
  }

  async loadData(start: Date, end: Date): Promise<UsageSummary> {
    const baseDir = this.getBaseDir()
    const dbPath = path.join(baseDir, 'state.db')

    if (!fs.existsSync(dbPath)) {
      return { provider: 'hermes', daily: [], insights: undefined, totalTokens: 0 }
    }

    const startMs = start.getTime()
    const endMs = end.getTime()
    const sessions = await this.loadSessions(dbPath, startMs, endMs)
    return this.aggregateSessions(sessions, startMs, endMs)
  }

  private pythonNoticeShown = false

  private showPythonNotice() {
    if (this.pythonNoticeShown) return
    this.pythonNoticeShown = true
    try {
      vscode.window.showInformationMessage(
        'SlopMeter: 未找到 Python，SQLite 读取将降级（可能缺少最新几秒数据）。安装 Python 3.7+ 可提升读取质量。',
        '知道了'
      )
    } catch {
      // running outside VSCode (tests)
    }
  }

  private async loadSessions(dbPath: string, startMs: number, endMs: number): Promise<HermesSession[]> {
    const pythonCmd = findPython()
    if (!pythonCmd) {
      this.showPythonNotice()
      console.error('Hermes Python script not available, trying sql.js fallback')
      return []
    }

    try {
      const { execSync } = require('child_process')
      const fs = require('fs')
      const os = require('os')
      const path = require('path')

      const tmpScript = path.join(os.tmpdir(), `slopmeter_hermes.py`)
      const pyCode = `
import sqlite3, json, sys, os, shutil, tempfile
db, s, e = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
d = tempfile.mkdtemp(prefix='sm-')
t = os.path.join(d, 'state.db')
shutil.copy2(db, t)
for x in ['-wal', '-shm']:
    p = db + x
    if os.path.exists(p): shutil.copy2(p, t + x)
c = sqlite3.connect('file:' + t + '?mode=ro', uri=True)
# started_at is in seconds (float), convert to ms for comparison
r = c.execute(
    """SELECT id, model, started_at, input_tokens, output_tokens,
              cache_read_tokens, cache_write_tokens, reasoning_tokens,
              message_count
       FROM sessions
       WHERE started_at * 1000 >= ? AND started_at * 1000 <= ?
         AND (input_tokens > 0 OR output_tokens > 0
              OR cache_read_tokens > 0 OR cache_write_tokens > 0)""",
    [s, e])
M = []
for row in r:
    M.append({
        'id': row[0],
        'model': row[1] or '',
        'started_at': row[2],
        'input_tokens': row[3] or 0,
        'output_tokens': row[4] or 0,
        'cache_read_tokens': row[5] or 0,
        'cache_write_tokens': row[6] or 0,
        'reasoning_tokens': row[7] or 0,
        'message_count': row[8] or 0
    })
c.close()
shutil.rmtree(d, ignore_errors=True)
json.dump(M, sys.stdout)
`
      fs.writeFileSync(tmpScript, pyCode)
      try {
        const result = execSync(
          `${pythonCmd} "${tmpScript}" "${dbPath}" ${startMs} ${endMs}`,
          { encoding: 'utf-8', timeout: 30000, maxBuffer: 100 * 1024 * 1024 }
        )
        const rows = JSON.parse(result)
        const sessions: HermesSession[] = []
        for (const row of rows) {
          if (row && typeof row === 'object') {
            sessions.push(row as HermesSession)
          }
        }
        return sessions
      } finally {
        try { fs.unlinkSync(tmpScript) } catch {}
      }
    } catch (e) {
      console.error('Hermes Python script failed:', e)
      return []
    }
  }

  private aggregateSessions(sessions: HermesSession[], startMs: number, endMs: number): UsageSummary {
    const dailyMap = new Map<string, {
      total: number; input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number;
      models: Map<string, TokenTotals>
    }>()

    for (const session of sessions) {
      if (!session.started_at) continue

      // started_at is in seconds, convert to ms for date formatting
      let tsMs = session.started_at * 1000
      if (tsMs < startMs || tsMs > endMs) continue

      const date = new Date(tsMs)
      const dateKey = formatDate(date)

      const inputTokens = session.input_tokens + session.cache_read_tokens + session.cache_write_tokens
      const outputTokens = session.output_tokens + session.reasoning_tokens
      const totalTokens = inputTokens + outputTokens

      if (totalTokens <= 0) continue

      if (!dailyMap.has(dateKey)) {
        dailyMap.set(dateKey, { total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, models: new Map() })
      }

      const day = dailyMap.get(dateKey)!
      day.total += totalTokens
      day.input += inputTokens
      day.output += outputTokens
      day.cacheRead += session.cache_read_tokens
      day.cacheWrite += session.cache_write_tokens
      day.reasoning += session.reasoning_tokens

      const modelName = session.model || 'hermes'
      if (!day.models.has(modelName)) {
        day.models.set(modelName, { input: 0, output: 0, cache: { input: 0, output: 0 }, total: 0 })
      }
      const mt = day.models.get(modelName)!
      mt.input += inputTokens
      mt.output += outputTokens
      mt.total += totalTokens
    }

    const daily: DailyUsage[] = []
    let totalTokensAll = 0
    const activityDates: string[] = []

    const sortedKeys = Array.from(dailyMap.keys()).sort()
    for (const key of sortedKeys) {
      const day = dailyMap.get(key)!
      totalTokensAll += day.total
      if (day.total > 0) activityDates.push(key)

      const breakdown: ModelUsage[] = []
      day.models.forEach((mt, name) => {
        breakdown.push({ name, tokens: mt })
      })
      breakdown.sort((a, b) => b.tokens.total - a.tokens.total)

      daily.push({
        date: key,
        input: day.input,
        output: day.output,
        cache: { input: day.cacheRead, output: day.cacheWrite },
        total: day.total,
        breakdown,
      })
    }

    const now = new Date()
    const insights: Insights = {
      streaks: {
        longest: computeLongestStreak(activityDates),
        current: computeCurrentStreak(activityDates, now),
      },
    }

    return { provider: 'hermes', daily, insights, totalTokens: totalTokensAll }
  }
}
