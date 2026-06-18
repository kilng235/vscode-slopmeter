import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { IProvider } from './types'
import {
  UsageSummary, ProviderId, TokenTotals, CacheTokens,
  DailyUsage, ModelUsage, Insights
} from '../models'
import { formatDate, parseTimestamp, computeLongestStreak, computeCurrentStreak } from '../utils'

interface OpenCodeMessage {
  id?: string
  modelID?: string
  tokens?: {
    input?: number
    output?: number
    reasoning?: number
    cache?: { read?: number; write?: number }
  }
  time?: { created?: number }
}

export class OpenCodeProvider implements IProvider {
  id: ProviderId = 'opencode'
  name = 'Open Code'

  private extensionUri?: string

  constructor(private customPath?: string, extensionUri?: string) {
    this.extensionUri = extensionUri
  }

  private getBaseDir(): string {
    if (this.customPath) return this.customPath
    
    const envDir = process.env.OPENCODE_DATA_DIR
    if (envDir) return envDir
    
    return path.join(os.homedir(), '.local', 'share', 'opencode')
  }

  isAvailable(): boolean {
    try {
      const baseDir = this.getBaseDir()
      if (!fs.existsSync(baseDir)) return false
      
      const dbPath = path.join(baseDir, 'opencode.db')
      const messagesDir = path.join(baseDir, 'storage', 'message')
      
      return fs.existsSync(dbPath) || fs.existsSync(messagesDir)
    } catch {
      return false
    }
  }

  async loadData(start: Date, end: Date): Promise<UsageSummary> {
    const baseDir = this.getBaseDir()
    const dbPath = path.join(baseDir, 'opencode.db')
    
    let messages: OpenCodeMessage[] = []
    
    if (fs.existsSync(dbPath)) {
      // Python script filters by date range directly
      const startMs = start.getTime()
      const endMs = end.getTime()
      messages = await this.loadFromDatabase(dbPath, startMs, endMs)
    }
    
    if (messages.length === 0) {
      const messagesDir = path.join(baseDir, 'storage', 'message')
      if (fs.existsSync(messagesDir)) {
        messages = this.loadFromFiles(messagesDir)
      }
    }
    
    return this.aggregateMessages(messages, start, end)
  }

  private async loadFromDatabase(dbPath: string, startMs: number, endMs: number): Promise<OpenCodeMessage[]> {
    try {
      return await this.loadViaSqlJs(dbPath, startMs, endMs)
    } catch (e) {
      console.error('Failed to load database:', e)
      return []
    }
  }

  private async loadViaSqlJs(dbPath: string, startMs: number, endMs: number): Promise<OpenCodeMessage[]> {
    try {
      const { execSync } = require('child_process')
      const fs = require('fs')
      const os = require('os')
      const path = require('path')

      const tmpScript = path.join(os.tmpdir(), `slopmeter_read.py`)
      const pyCode = `
import sqlite3, json, sys, os, shutil, tempfile
db, s, e = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
d = tempfile.mkdtemp(prefix='sm-')
t = os.path.join(d, 'opencode.db')
shutil.copy2(db, t)
for x in ['-wal', '-shm']:
    p = db + x
    if os.path.exists(p): shutil.copy2(p, t + x)
c = sqlite3.connect('file:' + t + '?mode=ro', uri=True)
r = c.execute("SELECT id, data FROM message WHERE time_created >= ? AND time_created <= ?", [s, e])
M = []
for i, d in r:
    try:
        m = json.loads(d); m['id'] = m.get('id') or str(i); M.append(m)
    except: pass
c.close()
shutil.rmtree(d, ignore_errors=True)
json.dump(M, sys.stdout)
`
      fs.writeFileSync(tmpScript, pyCode)
      try {
        const result = execSync(
          `python3 "${tmpScript}" "${dbPath}" ${startMs} ${endMs}`,
          { encoding: 'utf-8', timeout: 30000, maxBuffer: 100 * 1024 * 1024 }
        )
        const rows = JSON.parse(result)
        const messages: OpenCodeMessage[] = []
        for (const row of rows) {
          if (row && typeof row === 'object') {
            messages.push(row as OpenCodeMessage)
          }
        }
        return messages
      } finally {
        try { fs.unlinkSync(tmpScript) } catch {}
      }
    } catch (e) {
      console.error('Python script failed, trying sql.js fallback:', e)
      return await this.loadViaSqlJsFallback(dbPath)
    }
  }

  private async loadViaSqlJsFallback(dbPath: string): Promise<OpenCodeMessage[]> {
    const initSqlJs = require('sql.js')
    const buffer = fs.readFileSync(dbPath)
    const SQL = await initSqlJs()
    const db = new SQL.Database(buffer)
    const results = db.exec("SELECT id, data FROM message ORDER BY time_created ASC")
    db.close()

    if (results.length === 0) return []
    const rows = results[0].values
    const messages: OpenCodeMessage[] = []
    for (const row of rows) {
      try {
        const id = row[0]
        const rawData = row[1]
        const data = JSON.parse(rawData)
        data.id = data.id || String(id)
        messages.push(data as OpenCodeMessage)
      } catch {
        // skip invalid rows
      }
    }
    return messages
  }

  private getExtensionPath(): string {
    if (this.extensionUri) return this.extensionUri
    // Fallback: __dirname is out/providers, go up 2 levels to extension root
    return require('path').join(__dirname, '..', '..')
  }

  private loadFromFiles(dir: string): OpenCodeMessage[] {
    const messages: OpenCodeMessage[] = []
    this.walkDir(dir, '.json', (filePath) => {
      try {
        const content = fs.readFileSync(filePath, 'utf-8')
        const msg = JSON.parse(content)
        if (typeof msg === 'object' && msg !== null) {
          messages.push(msg)
        }
      } catch {
        // skip invalid files
      }
    })
    return messages
  }

  private walkDir(dir: string, ext: string, callback: (file: string) => void): void {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          this.walkDir(fullPath, ext, callback)
        } else if (entry.name.endsWith(ext)) {
          callback(fullPath)
        }
      }
    } catch {
      // skip
    }
  }

  private aggregateMessages(messages: OpenCodeMessage[], start: Date, end: Date): UsageSummary {
    const dailyMap = new Map<string, { total: number; input: number; output: number; cacheRead: number; cacheWrite: number; models: Map<string, TokenTotals> }>()
    const startMs = start.getTime()
    const endMs = end.getTime()

    for (const msg of messages) {
      const timeValue = msg.time?.created
      if (!timeValue) continue

      let ts = typeof timeValue === 'number' ? timeValue : parseInt(String(timeValue), 10)
      if (ts > 1e12) ts /= 1000

      if (ts < startMs / 1000 || ts > endMs / 1000) continue

      const date = new Date(ts * 1000)
      const dateKey = formatDate(date)

      const tokens = msg.tokens
      if (!tokens) continue

      const inputTokens = (tokens.input || 0) + (tokens.cache?.read || 0) + (tokens.cache?.write || 0)
      const outputTokens = tokens.output || 0
      const totalTokens = inputTokens + outputTokens
      if (totalTokens <= 0) continue

      if (!dailyMap.has(dateKey)) {
        dailyMap.set(dateKey, { total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, models: new Map() })
      }

      const day = dailyMap.get(dateKey)!
      day.total += totalTokens
      day.input += inputTokens
      day.output += outputTokens
      day.cacheRead += tokens.cache?.read || 0
      day.cacheWrite += tokens.cache?.write || 0

      if (msg.modelID) {
        if (!day.models.has(msg.modelID)) {
          day.models.set(msg.modelID, { input: 0, output: 0, cache: { input: 0, output: 0 }, total: 0 })
        }
        const mt = day.models.get(msg.modelID)!
        mt.input += inputTokens
        mt.output += outputTokens
        mt.total += totalTokens
      }
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

    return { provider: 'opencode', daily, insights, totalTokens: totalTokensAll }
  }
}
