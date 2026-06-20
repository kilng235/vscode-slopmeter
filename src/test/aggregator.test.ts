import { describe, it, expect } from 'vitest'
import { aggregateEntries, NormalizedEntry } from '../providers/aggregator'

describe('aggregateEntries', () => {
  it('returns empty for empty entries', () => {
    const start = new Date('2024-01-01')
    const end = new Date('2024-01-31')
    const result = aggregateEntries('opencode', [], start, end)
    expect(result.daily).toEqual([])
    expect(result.totalTokens).toBe(0)
  })

  it('aggregates single day entries', () => {
    const start = new Date('2024-01-01')
    const end = new Date('2024-01-31')
    const entries: NormalizedEntry[] = [{
      timestamp: new Date('2024-01-15T10:00:00').getTime(),
      inputTokens: 100, outputTokens: 50, cacheRead: 10, cacheWrite: 5,
      modelName: 'gpt-4'
    }]
    const result = aggregateEntries('opencode', entries, start, end)
    expect(result.daily.length).toBe(1)
    expect(result.daily[0].total).toBe(150)
    expect(result.daily[0].input).toBe(100)
    expect(result.daily[0].output).toBe(50)
  })

  it('filters entries outside date range', () => {
    const start = new Date('2024-01-01')
    const end = new Date('2024-01-31')
    const entries: NormalizedEntry[] = [{
      timestamp: new Date('2023-12-15').getTime(),
      inputTokens: 100, outputTokens: 50, cacheRead: 0, cacheWrite: 0,
      modelName: 'gpt-4'
    }]
    const result = aggregateEntries('opencode', entries, start, end)
    expect(result.daily.length).toBe(0)
  })
})
