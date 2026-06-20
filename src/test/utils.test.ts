import { describe, it, expect } from 'vitest'
import { formatDate, parseTimestamp, getHeatmapLevel, computeLongestStreak, computeCurrentStreak, formatTokenTotal } from '../utils'

describe('formatDate', () => {
  it('formats date correctly', () => {
    expect(formatDate(new Date(2024, 0, 15))).toBe('2024-01-15')
  })
})

describe('parseTimestamp', () => {
  it('parses seconds timestamp', () => {
    const result = parseTimestamp(1705276800)
    expect(result).not.toBeNull()
    expect(result!.getFullYear()).toBe(2024)
  })

  it('parses milliseconds timestamp', () => {
    const result = parseTimestamp(1705276800000)
    expect(result).not.toBeNull()
    expect(result!.getFullYear()).toBe(2024)
  })

  it('returns null for undefined', () => {
    expect(parseTimestamp(undefined)).toBeNull()
  })
})

describe('getHeatmapLevel', () => {
  it('returns 0 for zero or negative values', () => {
    expect(getHeatmapLevel(0, 100)).toBe(0)
    expect(getHeatmapLevel(-1, 100)).toBe(0)
  })

  it('returns top level for max value', () => {
    // gamma=0.7, pow(1, 0.7)=1, ceil(1*4)-1=3
    expect(getHeatmapLevel(100, 100)).toBe(3)
  })
})

describe('formatTokenTotal', () => {
  it('formats large numbers with suffix', () => {
    expect(formatTokenTotal(1500)).toBe('1.5K')
    expect(formatTokenTotal(1500000)).toBe('1.5M')
  })

  it('formats small numbers as-is', () => {
    expect(formatTokenTotal(999)).toBe('999')
  })
})
