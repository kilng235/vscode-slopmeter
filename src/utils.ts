import * as fs from 'fs'
import * as path from 'path'

export function formatDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function parseTimestamp(value: number | string | undefined): Date | null {
  if (value === undefined || value === null) return null

  if (typeof value === 'number') {
    let ts = value
    if (ts > 1e12) ts /= 1000
    try {
      return new Date(ts * 1000)
    } catch {
      return null
    }
  }

  if (typeof value === 'string') {
    const num = parseInt(value, 10)
    if (!isNaN(num)) return parseTimestamp(num)
    const d = new Date(value)
    return isNaN(d.getTime()) ? null : d
  }

  return null
}

export function getDaysArray(days: number): Date[] {
  const result: Date[] = []
  const today = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(today)
    date.setDate(date.getDate() - i)
    result.push(date)
  }
  return result
}

export function getWeekDay(date: Date): number {
  return date.getDay()
}

export function getMonthName(date: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return months[date.getMonth()]
}

export function getHeatmapLevel(value: number, maxValue: number): number {
  if (maxValue <= 0 || value <= 0) return 0
  const gamma = 0.7
  const scaled = Math.pow(value / maxValue, gamma)
  const index = Math.ceil(scaled * 4) - 1
  return Math.max(0, Math.min(index, 4))
}

export function computeLongestStreak(dates: string[]): number {
  if (dates.length === 0) return 0
  const sorted = [...new Set(dates)].sort()
  let longest = 1
  let current = 1
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1])
    const curr = new Date(sorted[i])
    const diffDays = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24)
    if (Math.abs(diffDays - 1) < 0.1) {
      current++
      longest = Math.max(longest, current)
    } else {
      current = 1
    }
  }
  return longest
}

export function computeCurrentStreak(dates: string[], endDate: Date): number {
  if (dates.length === 0) return 0
  const sorted = [...new Set(dates)].sort()
  const endStr = formatDate(endDate)
  const lastDate = sorted[sorted.length - 1]

  const endMs = new Date(endStr).getTime()
  const lastMs = new Date(lastDate).getTime()
  const diffDays = (endMs - lastMs) / (1000 * 60 * 60 * 24)

  if (lastDate !== endStr && Math.abs(diffDays) > 1.1) {
    return 0
  }

  let current = 1
  for (let i = sorted.length - 2; i >= 0; i--) {
    const curr = new Date(sorted[i + 1])
    const prev = new Date(sorted[i])
    const diff = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24)
    if (Math.abs(diff - 1) < 0.1) {
      current++
    } else {
      break
    }
  }
  return current
}

export function formatTokenTotal(value: number): string {
  const units: [number, string][] = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ]
  for (const [size, suffix] of units) {
    if (value >= size) {
      const scaled = value / size
      const precision = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2
      const compact = scaled.toFixed(precision).replace(/\.?0+$/, '')
      return `${compact}${suffix}`
    }
  }
  return value.toLocaleString()
}

export function walkDir(dir: string, ext: string, callback: (file: string) => void): void {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walkDir(fullPath, ext, callback)
      } else if (entry.name.endsWith(ext)) {
        callback(fullPath)
      }
    }
  } catch {
    // skip
  }
}
