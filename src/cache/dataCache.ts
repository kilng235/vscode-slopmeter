import { UsageSummary } from '../models'

interface CacheEntry {
  summary: UsageSummary
  mtime: number
  timestamp: number
}

export interface MtimeProvider {
  (providerId: string): number
}

export interface CacheStats {
  hits: number
  misses: number
  size: number
  hitRate: number
}

export class DataCache {
  private cache = new Map<string, CacheEntry>()
  private hits = 0
  private misses = 0

  constructor(
    private getMtime: MtimeProvider,
    private maxEntriesPerProvider: number = 12
  ) {}

  async get(
    providerId: string,
    year: number,
    month: number,
    loader: () => Promise<UsageSummary>
  ): Promise<UsageSummary> {
    const key = `${providerId}:${year}-${String(month).padStart(2, '0')}`
    const currentMtime = this.getMtime(providerId)

    const entry = this.cache.get(key)

    // 命中：mtime 一致且大于 0
    if (entry && entry.mtime === currentMtime && currentMtime > 0) {
      this.hits++
      entry.timestamp = Date.now()
      return entry.summary
    }

    // 未命中：调用 loader
    this.misses++
    const summary = await loader()

    this.cache.set(key, {
      summary,
      mtime: currentMtime,
      timestamp: Date.now()
    })

    this.evictIfNeeded(providerId)
    return summary
  }

  invalidate(providerId?: string): void {
    if (!providerId) {
      this.cache.clear()
      this.hits = 0
      this.misses = 0
      return
    }
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${providerId}:`)) {
        this.cache.delete(key)
      }
    }
  }

  getStats(): CacheStats {
    const total = this.hits + this.misses
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.cache.size,
      hitRate: total > 0 ? this.hits / total : 0
    }
  }

  private evictIfNeeded(providerId: string): void {
    let count = 0
    let oldestKey: string | null = null
    let oldestTime = Infinity
    const prefix = `${providerId}:`

    for (const [key, entry] of this.cache.entries()) {
      if (!key.startsWith(prefix)) continue
      count++
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp
        oldestKey = key
      }
    }

    if (count > this.maxEntriesPerProvider && oldestKey) {
      this.cache.delete(oldestKey)
    }
  }
}
