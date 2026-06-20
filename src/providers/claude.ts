import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { IProvider } from './types'
import { UsageSummary, ProviderId } from '../models'
import { findClaudeDir, tryMtime } from '../platform/paths'
import { aggregateEntries, NormalizedEntry } from './aggregator'
import { walkDir } from '../utils'

interface ClaudeMessage {
  message?: {
    id?: string
    metadata?: {
      input_tokens?: number
      output_tokens?: number
      cache_creation_input_tokens?: number
      cache_read_input_tokens?: number
      tokens?: {
        input?: number
        output?: number
        cache_read?: number
        cache_write?: number
      }
    }
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
    }
    sender?: { type?: string }
    conversation_uuid?: string
    timestamp?: string
    model?: string
  }
  timestamp?: string
  model?: string
  tokens?: {
    input: number
    output: number
    cache_read?: number
    cache_write?: number
  }
}

export class ClaudeProvider implements IProvider {
  id: ProviderId = 'claude'
  name = 'Claude Code'

  private extensionUri?: string

  constructor(private customPath?: string, extensionUri?: string) {
    this.extensionUri = extensionUri
  }

  private getBaseDir(): string {
    if (this.customPath) return this.customPath
    const dir = findClaudeDir()
    return dir || path.join(os.homedir(), '.claude')
  }

  isAvailable(): boolean {
    try {
      const baseDir = this.getBaseDir()
      if (!fs.existsSync(baseDir)) return false
      const projectsDir = path.join(baseDir, 'projects')
      const storageDir = path.join(baseDir, 'storage')
      return fs.existsSync(projectsDir) || fs.existsSync(storageDir)
    } catch {
      return false
    }
  }

  async loadData(start: Date, end: Date): Promise<UsageSummary> {
    const messages = this.collectMessages()
    const entries = this.normalizeEntries(messages, start, end)
    return aggregateEntries('claude', entries, start, end)
  }

  private collectMessages(): ClaudeMessage[] {
    const messages: ClaudeMessage[] = []
    const baseDir = this.getBaseDir()
    const projectsDir = path.join(baseDir, 'projects')

    if (fs.existsSync(projectsDir)) {
      walkDir(projectsDir, '.json', (filePath) => {
        try {
          const content = fs.readFileSync(filePath, 'utf-8')
          const data = JSON.parse(content)
          if (Array.isArray(data)) {
            for (const item of data) {
              if (item && (item.message || item.tokens)) {
                messages.push(item)
              }
            }
          } else if (data && (data.message || data.tokens)) {
            messages.push(data)
          }
        } catch {
          // skip
        }
      })

      walkDir(projectsDir, '.jsonl', (filePath) => {
        try {
          const content = fs.readFileSync(filePath, 'utf-8')
          const lines = content.split('\n')
          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed) continue
            try {
              const item = JSON.parse(trimmed)
              if (item && (item.message || item.tokens)) {
                messages.push(item)
              }
            } catch {
              // skip invalid line
            }
          }
        } catch {
          // skip
        }
      })
    }

    return messages
  }

  private normalizeEntries(messages: ClaudeMessage[], start: Date, end: Date): NormalizedEntry[] {
    const entries: NormalizedEntry[] = []
    const startMs = start.getTime()
    const endMs = end.getTime()

    for (const msg of messages) {
      let ts = 0
      if (msg.timestamp) {
        ts = new Date(msg.timestamp).getTime()
      } else if (msg.message?.timestamp) {
        ts = new Date(msg.message.timestamp).getTime()
      }
      if (!ts) continue

      if (ts < startMs || ts > endMs) continue

      const meta = msg.message?.metadata || {}
      const usage = msg.message?.usage || {}
      const tok = msg.tokens

      const inputTokens = tok?.input || usage.input_tokens || meta.input_tokens || 0
      const outputTokens = tok?.output || usage.output_tokens || meta.output_tokens || 0
      const cacheRead = tok?.cache_read || usage.cache_read_input_tokens || meta.cache_read_input_tokens || 0
      const cacheWrite = tok?.cache_write || usage.cache_creation_input_tokens || meta.cache_creation_input_tokens || 0

      if (inputTokens + outputTokens <= 0) continue

      entries.push({
        timestamp: ts,
        inputTokens: inputTokens + cacheRead + cacheWrite,
        outputTokens,
        cacheRead,
        cacheWrite,
        modelName: msg.model || msg.message?.model || 'claude',
      })
    }

    return entries
  }
}
