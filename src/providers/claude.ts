import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { IProvider } from './types'
import {
  UsageSummary, ProviderId, TokenTotals,
  DailyUsage, ModelUsage, Insights
} from '../models'
import { formatDate, computeLongestStreak, computeCurrentStreak } from '../utils'
import { findClaudeDir, tryMtime } from '../platform/paths'

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
    return this.aggregateMessages(messages, start, end)
  }

  private collectMessages(): ClaudeMessage[] {
    const messages: ClaudeMessage[] = []
    const baseDir = this.getBaseDir()
    const projectsDir = path.join(baseDir, 'projects')

    if (fs.existsSync(projectsDir)) {
      // Collect .json files (legacy format)
      this.walkDir(projectsDir, '.json', (filePath) => {
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

      // Collect .jsonl files (new format with usage tokens)
      this.walkDir(projectsDir, '.jsonl', (filePath) => {
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

  private aggregateMessages(messages: ClaudeMessage[], start: Date, end: Date): UsageSummary {
    const dailyMap = new Map<string, {
      total: number; input: number; output: number; cacheRead: number; cacheWrite: number;
      models: Map<string, TokenTotals>
    }>()
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

      const dateKey = formatDate(new Date(ts))
      const meta = msg.message?.metadata || {}
      const usage = msg.message?.usage || {}
      const tok = msg.tokens

      // Support multiple token formats
      const inputTokens = tok?.input || usage.input_tokens || meta.input_tokens || 0
      const outputTokens = tok?.output || usage.output_tokens || meta.output_tokens || 0
      const cacheRead = tok?.cache_read || usage.cache_read_input_tokens || meta.cache_read_input_tokens || 0
      const cacheWrite = tok?.cache_write || usage.cache_creation_input_tokens || meta.cache_creation_input_tokens || 0
      const totalTokens = inputTokens + outputTokens + cacheRead + cacheWrite
      if (totalTokens <= 0) continue

      if (!dailyMap.has(dateKey)) {
        dailyMap.set(dateKey, { total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, models: new Map() })
      }

      const day = dailyMap.get(dateKey)!
      day.total += totalTokens
      day.input += inputTokens
      day.output += outputTokens
      day.cacheRead += cacheRead
      day.cacheWrite += cacheWrite

      const modelName = msg.model || msg.message?.model || 'claude'
      if (!day.models.has(modelName)) {
        day.models.set(modelName, { input: 0, output: 0, cache: { input: 0, output: 0 }, total: 0 })
      }
      const mt = day.models.get(modelName)!
      mt.input += inputTokens
      mt.output += outputTokens
      mt.cache.input += cacheRead
      mt.cache.output += cacheWrite
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

    return { provider: 'claude', daily, insights, totalTokens: totalTokensAll }
  }
}
