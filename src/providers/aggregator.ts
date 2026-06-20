import { ProviderId, UsageSummary, DailyUsage, ModelUsage, TokenTotals, Insights } from '../models'
import { formatDate, computeLongestStreak, computeCurrentStreak } from '../utils'

export interface NormalizedEntry {
  timestamp: number
  inputTokens: number
  outputTokens: number
  cacheRead: number
  cacheWrite: number
  modelName: string
}

interface DailyAccumulator {
  total: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  models: Map<string, TokenTotals>
  hourly: { hour: number; total: number; input: number; output: number }[]
}

export function aggregateEntries(
  providerId: ProviderId,
  entries: NormalizedEntry[],
  start: Date,
  end: Date
): UsageSummary {
  const startMs = start.getTime()
  const endMs = end.getTime()
  const dailyMap = new Map<string, DailyAccumulator>()

  for (const entry of entries) {
    const ts = entry.timestamp
    if (ts < startMs || ts > endMs) continue

    const date = new Date(ts)
    const dateKey = formatDate(date)
    const totalTokens = entry.inputTokens + entry.outputTokens
    if (totalTokens <= 0) continue

    if (!dailyMap.has(dateKey)) {
      dailyMap.set(dateKey, {
        total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
        models: new Map(), hourly: []
      })
    }

    const day = dailyMap.get(dateKey)!
    day.total += totalTokens
    day.input += entry.inputTokens
    day.output += entry.outputTokens
    day.cacheRead += entry.cacheRead
    day.cacheWrite += entry.cacheWrite

    const hour = date.getHours()
    let hourEntry = day.hourly.find(h => h.hour === hour)
    if (!hourEntry) {
      hourEntry = { hour, total: 0, input: 0, output: 0 }
      day.hourly.push(hourEntry)
    }
    hourEntry.total += totalTokens
    hourEntry.input += entry.inputTokens
    hourEntry.output += entry.outputTokens

    if (entry.modelName) {
      if (!day.models.has(entry.modelName)) {
        day.models.set(entry.modelName, { input: 0, output: 0, cache: { input: 0, output: 0 }, total: 0 })
      }
      const mt = day.models.get(entry.modelName)!
      mt.input += entry.inputTokens
      mt.output += entry.outputTokens
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
      hourly: day.hourly || [],
    })
  }

  const modelTotals = new Map<string, number>()
  for (const day of daily) {
    for (const m of day.breakdown) {
      modelTotals.set(m.name, (modelTotals.get(m.name) || 0) + m.tokens.total)
    }
  }

  let mostUsedModel: ModelUsage | undefined
  if (modelTotals.size > 0) {
    const sorted = Array.from(modelTotals.entries()).sort((a, b) => b[1] - a[1])
    mostUsedModel = { name: sorted[0][0], tokens: { input: 0, output: 0, cache: { input: 0, output: 0 }, total: sorted[0][1] } }
  }

  const now = new Date()
  const insights: Insights = {
    streaks: {
      longest: computeLongestStreak(activityDates),
      current: computeCurrentStreak(activityDates, now),
    },
    mostUsedModel,
  }

  return { provider: providerId, daily, insights, totalTokens: totalTokensAll }
}
