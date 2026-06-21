import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as vscode from 'vscode'
import { IProvider } from './types'
import { UsageSummary, ProviderId } from '../models'
import { findCodexDir } from '../platform/paths'
import { findPython, showPythonNotice } from '../platform/python'
import { aggregateEntries, NormalizedEntry } from './aggregator'

interface CodexThread {
  id: string
  created_at: number
  model_provider: string
  title: string
  tokens_used: number
  rollout_path: string
}

export class CodexProvider implements IProvider {
  id: ProviderId = 'codex'
  name = 'Codex'

  private extensionUri?: string

  constructor(private customPath?: string, extensionUri?: string) {
    this.extensionUri = extensionUri
  }

  private getBaseDir(): string {
    if (this.customPath) return this.customPath
    const dir = findCodexDir()
    return dir || path.join(os.homedir(), '.codex')
  }

  isAvailable(): boolean {
    try {
      const baseDir = this.getBaseDir()
      if (!fs.existsSync(baseDir)) return false
      const dbPath = path.join(baseDir, 'state_5.sqlite')
      return fs.existsSync(dbPath)
    } catch {
      return false
    }
  }

  async loadData(start: Date, end: Date): Promise<UsageSummary> {
    const baseDir = this.getBaseDir()
    const dbPath = path.join(baseDir, 'state_5.sqlite')

    if (!fs.existsSync(dbPath)) {
      return { provider: 'codex', daily: [], insights: undefined, totalTokens: 0 }
    }

    const startMs = start.getTime()
    const endMs = end.getTime()
    const threads = await this.loadThreads(dbPath, startMs, endMs)
    const entries = this.normalizeEntries(threads, start, end)
    return aggregateEntries('codex', entries, start, end)
  }

  private async loadThreads(dbPath: string, startMs: number, endMs: number): Promise<CodexThread[]> {
    const pythonCmd = findPython()
    if (!pythonCmd) {
      showPythonNotice()
      console.error('Codex Python not available')
      return []
    }

    try {
      const { runPythonScript } = await import('../platform/python')
      const pyCode = `
import sqlite3, json, sys, os, shutil, tempfile
db, s, e = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
d = tempfile.mkdtemp(prefix='sm-')
t = os.path.join(d, 'state_5.sqlite')
shutil.copy2(db, t)
for x in ['-wal', '-shm']:
    p = db + x
    if os.path.exists(p): shutil.copy2(p, t + x)
c = sqlite3.connect('file:' + t + '?mode=ro', uri=True)
r = c.execute(
    """SELECT id, created_at, model_provider, title, tokens_used, rollout_path
       FROM threads
       WHERE created_at * 1000 >= ? AND created_at * 1000 <= ?
         AND tokens_used > 0""",
    [s, e])
M = []
for row in r:
    M.append({
        'id': row[0],
        'created_at': row[1],
        'model_provider': row[2] or 'custom',
        'title': row[3] or '',
        'tokens_used': row[4] or 0,
        'rollout_path': row[5] or ''
    })
c.close()
shutil.rmtree(d, ignore_errors=True)
json.dump(M, sys.stdout)
`
      const result = await runPythonScript(pythonCmd, pyCode, [dbPath, String(startMs), String(endMs)])
      const rows = JSON.parse(result)
      const threads: CodexThread[] = []
      for (const row of rows) {
        if (row && typeof row === 'object') {
          threads.push(row as CodexThread)
        }
      }
      return threads
    } catch (e) {
      console.error('Codex Python script failed:', e)
      return []
    }
  }

  private normalizeEntries(threads: CodexThread[], start: Date, end: Date): NormalizedEntry[] {
    const entries: NormalizedEntry[] = []
    const startMs = start.getTime()
    const endMs = end.getTime()

    for (const thread of threads) {
      if (!thread.created_at) continue

      const tsMs = thread.created_at * 1000
      if (tsMs < startMs || tsMs > endMs) continue

      if (thread.tokens_used <= 0) continue

      const modelName = this.extractModelFromRollout(thread.rollout_path)

      entries.push({
        timestamp: tsMs,
        inputTokens: thread.tokens_used,
        outputTokens: 0,
        cacheRead: 0,
        cacheWrite: 0,
        modelName: modelName,
      })
    }

    return entries
  }

  private extractModelFromRollout(rolloutPath: string): string {
    if (!rolloutPath) return 'codex'

    try {
      const fullPath = path.resolve(rolloutPath)
      if (!fs.existsSync(fullPath)) return 'codex'

      const firstLine = fs.readFileSync(fullPath, 'utf-8').split('\n')[0]
      if (!firstLine) return 'codex'

      const data = JSON.parse(firstLine)
      // Check session_meta or first event for model info
      if (data.payload?.model) return data.payload.model
      if (data.payload?.model_provider) return data.payload.model_provider

      // Read a few more lines to find model
      const lines = fs.readFileSync(fullPath, 'utf-8').split('\n')
      for (let i = 1; i < Math.min(lines.length, 10); i++) {
        try {
          const line = JSON.parse(lines[i])
          if (line.payload?.model) return line.payload.model
        } catch {}
      }
    } catch {}

    return 'codex'
  }
}
