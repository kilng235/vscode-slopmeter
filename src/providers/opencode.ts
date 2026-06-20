import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as vscode from 'vscode'
import { IProvider } from './types'
import { UsageSummary, ProviderId } from '../models'
import { findOpenCodeDir } from '../platform/paths'
import { findPython, showPythonNotice } from '../platform/python'
import { aggregateEntries, NormalizedEntry } from './aggregator'
import { walkDir } from '../utils'

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
    const dir = findOpenCodeDir()
    return dir || path.join(os.homedir(), '.local', 'share', 'opencode')
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

    const entries = this.normalizeEntries(messages, start, end)
    return aggregateEntries('opencode', entries, start, end)
  }

  private normalizeEntries(messages: OpenCodeMessage[], start: Date, end: Date): NormalizedEntry[] {
    const entries: NormalizedEntry[] = []
    const startMs = start.getTime()
    const endMs = end.getTime()

    for (const msg of messages) {
      const timeValue = msg.time?.created
      if (!timeValue) continue

      let ts = typeof timeValue === 'number' ? timeValue : parseInt(String(timeValue), 10)
      if (ts > 1e12) ts /= 1000
      const timestampMs = ts * 1000

      if (timestampMs < startMs || timestampMs > endMs) continue

      const tokens = msg.tokens
      if (!tokens) continue

      const inputTokens = tokens.input || 0
      const outputTokens = tokens.output || 0
      if (inputTokens + outputTokens <= 0) continue

      entries.push({
        timestamp: timestampMs,
        inputTokens,
        outputTokens,
        cacheRead: tokens.cache?.read || 0,
        cacheWrite: tokens.cache?.write || 0,
        modelName: msg.modelID || 'unknown',
      })
    }

    return entries
  }

  private async loadFromDatabase(dbPath: string, startMs: number, endMs: number): Promise<OpenCodeMessage[]> {
    try {
      return await this.loadViaSqlJsAsync(dbPath, startMs, endMs)
    } catch (e) {
      console.error('Failed to load database:', e)
      return []
    }
  }

  private async loadViaSqlJsAsync(dbPath: string, startMs: number, endMs: number): Promise<OpenCodeMessage[]> {
    const pythonCmd = findPython()
    if (!pythonCmd) {
      showPythonNotice()
      return await this.loadViaSqlJsFallback(dbPath, startMs, endMs)
    }

    try {
      const { runPythonScript } = await import('../platform/python')
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
      const result = await runPythonScript(
        pythonCmd,
        pyCode,
        [dbPath, String(startMs), String(endMs)],
        30000
      )
      const rows = JSON.parse(result)
      const messages: OpenCodeMessage[] = []
      for (const row of rows) {
        if (row && typeof row === 'object') {
          messages.push(row as OpenCodeMessage)
        }
      }
      return messages
    } catch (e) {
      console.error('Python script failed, trying sql.js fallback:', e)
      return await this.loadViaSqlJsFallback(dbPath, startMs, endMs)
    }
  }

  private async loadViaSqlJsFallback(dbPath: string, startMs: number, endMs: number): Promise<OpenCodeMessage[]> {
    const initSqlJs = require('sql.js')
    const buffer = fs.readFileSync(dbPath)
    const SQL = await initSqlJs()
    const db = new SQL.Database(buffer)

    const stmt = db.prepare("SELECT id, data FROM message WHERE time_created >= ? AND time_created <= ? ORDER BY time_created ASC")
    stmt.bind([startMs, endMs])

    const messages: OpenCodeMessage[] = []
    while (stmt.step()) {
      const row = stmt.get()
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
    stmt.free()
    db.close()
    return messages
  }

  private loadFromFiles(dir: string): OpenCodeMessage[] {
    const messages: OpenCodeMessage[] = []
    walkDir(dir, '.json', (filePath) => {
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
}
