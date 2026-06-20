import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as vscode from 'vscode'
import { IProvider } from './types'
import { UsageSummary, ProviderId } from '../models'
import { findHermesDir } from '../platform/paths'
import { findPython, showPythonNotice } from '../platform/python'
import { aggregateEntries, NormalizedEntry } from './aggregator'

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
    const entries = this.normalizeEntries(sessions, start, end)
    return aggregateEntries('hermes', entries, start, end)
  }

  private async loadSessions(dbPath: string, startMs: number, endMs: number): Promise<HermesSession[]> {
    const pythonCmd = findPython()
    if (!pythonCmd) {
      showPythonNotice()
      console.error('Hermes Python not available, trying sql.js fallback')
      return await this.loadViaSqlJsFallback(dbPath, startMs, endMs)
    }

    try {
      const { runPythonScript } = await import('../platform/python')
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
      const result = await runPythonScript(
        pythonCmd,
        pyCode,
        [dbPath, String(startMs), String(endMs)],
        30000
      )
      const rows = JSON.parse(result)
      const sessions: HermesSession[] = []
      for (const row of rows) {
        if (row && typeof row === 'object') {
          sessions.push(row as HermesSession)
        }
      }
      return sessions
    } catch (e) {
      console.error('Hermes Python script failed, trying sql.js fallback:', e)
      return await this.loadViaSqlJsFallback(dbPath, startMs, endMs)
    }
  }

  private async loadViaSqlJsFallback(dbPath: string, startMs: number, endMs: number): Promise<HermesSession[]> {
    try {
      const initSqlJs = require('sql.js')
      const buffer = fs.readFileSync(dbPath)
      const SQL = await initSqlJs()
      const db = new SQL.Database(buffer)

      const stmt = db.prepare(`
        SELECT id, model, started_at, input_tokens, output_tokens,
               cache_read_tokens, cache_write_tokens, reasoning_tokens,
               message_count
        FROM sessions
        WHERE started_at * 1000 >= ? AND started_at * 1000 <= ?
      `)
      stmt.bind([startMs, endMs])

      const sessions: HermesSession[] = []
      while (stmt.step()) {
        const row = stmt.get()
        sessions.push({
          id: row[0] || '',
          model: row[1] || '',
          started_at: row[2] || 0,
          input_tokens: row[3] || 0,
          output_tokens: row[4] || 0,
          cache_read_tokens: row[5] || 0,
          cache_write_tokens: row[6] || 0,
          reasoning_tokens: row[7] || 0,
          message_count: row[8] || 0,
        })
      }
      stmt.free()
      db.close()
      return sessions
    } catch (e) {
      console.error('Hermes sql.js fallback failed:', e)
      return []
    }
  }

  private normalizeEntries(sessions: HermesSession[], start: Date, end: Date): NormalizedEntry[] {
    const entries: NormalizedEntry[] = []
    const startMs = start.getTime()
    const endMs = end.getTime()

    for (const session of sessions) {
      if (!session.started_at) continue

      const tsMs = session.started_at * 1000
      if (tsMs < startMs || tsMs > endMs) continue

      const inputTokens = session.input_tokens + session.cache_read_tokens + session.cache_write_tokens
      const outputTokens = session.output_tokens + session.reasoning_tokens
      if (inputTokens + outputTokens <= 0) continue

      entries.push({
        timestamp: tsMs,
        inputTokens,
        outputTokens,
        cacheRead: session.cache_read_tokens,
        cacheWrite: session.cache_write_tokens,
        modelName: session.model || 'hermes',
      })
    }

    return entries
  }
}
