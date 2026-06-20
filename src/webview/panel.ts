import * as vscode from 'vscode'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { getProviderRegistry } from '../providers'
import { PROVIDER_META, ColorMode } from '../models'
import { DataCache } from '../cache/dataCache'
import { formatDate } from '../utils'

interface HeatmapSection {
  title: string
  daily: { date: string; total: number; input: number; output: number; cacheRead: number; cacheWrite: number }[]
  totalTokens: number
  totalInput: number
  totalOutput: number
  totalCacheRead: number
  totalCacheWrite: number
  insights?: {
    streaks: { longest: number; current: number }
    mostUsedModel?: { name: string; tokens: number }
  }
  yesterdayHourly: { hour: number; total: number; input: number; output: number }[]
  colors: string[]
}

interface HeatmapPayload {
  sections: HeatmapSection[]
  year: number
  month: number
  isCurrentMonth: boolean
  colorMode: string
}

export class SlopMeterPanel implements vscode.WebviewViewProvider {
  public static readonly viewType = 'slopMeter.heatmap'
  private view?: vscode.WebviewView
  private outputChannel = vscode.window.createOutputChannel('SlopMeter')
  private currentYear: number
  private currentMonth: number // 1-12
  private cache: DataCache

  constructor(private readonly extensionUri: vscode.Uri) {
    const now = new Date()
    this.currentYear = now.getFullYear()
    this.currentMonth = now.getMonth() + 1

    // Initialize cache with mtime provider
    this.cache = new DataCache(
      (providerId) => this.getProviderMtime(providerId),
      12
    )
  }

  private getProviderMtime(providerId: string): number {
    try {
      const home = os.homedir()
      const config = vscode.workspace.getConfiguration('slopMeter')

      if (providerId === 'opencode') {
        const dir = config.get<string>('openCodePath') || path.join(home, '.local', 'share', 'opencode')
        return this.maxMtime(path.join(dir, 'opencode.db'))
      }
      if (providerId === 'hermes') {
        const dir = config.get<string>('hermesPath') || path.join(home, '.hermes')
        return this.maxMtime(path.join(dir, 'state.db'))
      }
      if (providerId === 'claude') {
        const dir = config.get<string>('claudePath') || path.join(home, '.claude')
        return this.maxMtime(path.join(dir, 'history.jsonl'))
      }
    } catch {
      // ignore
    }
    return 0
  }

  private maxMtime(filePath: string): number {
    try {
      if (!fs.existsSync(filePath)) return 0
      return fs.statSync(filePath).mtimeMs
    } catch {
      return 0
    }
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView
    webviewView.webview.options = {
      enableScripts: true,
    }
    webviewView.webview.html = this.getHtmlContent()

    webviewView.webview.onDidReceiveMessage((message) => {
      if (message.type === 'ready') {
        this.sendUpdate()
      } else if (message.type === 'refresh') {
        this.sendUpdate()
      } else if (message.type === 'navigate') {
        const { year, month } = message
        if (typeof year === 'number' && typeof month === 'number') {
          this.navigateMonth(year, month)
        }
      }
    })
  }

  private getHtmlContent(): string {
    const htmlPath = vscode.Uri.joinPath(this.extensionUri, 'webview-ui', 'index.html')
    try {
      return fs.readFileSync(htmlPath.fsPath, 'utf-8')
    } catch {
      return '<html><body><h2>Error: webview-ui/index.html not found</h2></body></html>'
    }
  }

  refresh() {
    this.sendUpdate()
  }

  invalidateCache(providerId?: string): void {
    this.cache.invalidate(providerId)
    this.outputChannel.appendLine(
      `[SlopMeter] Cache invalidated${providerId ? ': ' + providerId : ' (all)'}`
    )
  }

  private navigateMonth(year: number, month: number) {
    this.currentYear = year
    this.currentMonth = month
    this.sendUpdate()
  }

  private async sendUpdate() {
    if (!this.view) return

    const config = vscode.workspace.getConfiguration('slopMeter')
    const providers = config.get<string[]>('providers', ['opencode', 'claude', 'hermes'])
    const colorMode = config.get<string>('colorMode', 'auto')

    // Detect color mode
    const isDark = colorMode === 'dark' || (colorMode === 'auto' && vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark)
    const mode: ColorMode = isDark ? 'dark' : 'light'

    this.view.webview.postMessage({ type: 'theme', isDark })

    // Calculate date range for the current month
    const start = new Date(this.currentYear, this.currentMonth - 1, 1, 0, 0, 0, 0)
    const end = new Date(this.currentYear, this.currentMonth, 0, 23, 59, 59, 999)

    // Don't go beyond today
    const now = new Date()
    const effectiveEnd = end.getTime() > now.getTime() ? now : end
    const isCurrentMonth = start.getFullYear() === now.getFullYear() && start.getMonth() === now.getMonth()

    this.outputChannel.appendLine(`[SlopMeter] Loading month: ${this.currentYear}-${String(this.currentMonth).padStart(2, '0')}`)

    const sections: HeatmapSection[] = []

    const registry = getProviderRegistry()
    for (const providerId of providers) {
      const provider = registry.getProvider(providerId as any)
      if (!provider) continue

      try {
        // Load from cache (with mtime invalidation)
        const summary = await this.cache.get(
          providerId,
          this.currentYear,
          this.currentMonth,
          () => provider!.loadData(start, effectiveEnd)
        )

        this.outputChannel.appendLine(`[SlopMeter] ${providerId} loaded: ${summary.daily.length} days, ${summary.totalTokens} total tokens`)
        for (const d of summary.daily.slice(0, 5)) {
          this.outputChannel.appendLine(`[SlopMeter]   ${d.date}: ${d.total} tokens`)
        }
        const meta = PROVIDER_META[providerId as keyof typeof PROVIDER_META] || PROVIDER_META.opencode

        sections.push({
          title: meta.name,
          daily: summary.daily.map(d => ({
            date: d.date,
            total: d.total,
            input: d.input,
            output: d.output,
            cacheRead: d.cache.input,
            cacheWrite: d.cache.output,
          })),
          totalTokens: summary.totalTokens,
          totalInput: summary.daily.reduce((s, d) => s + d.input, 0),
          totalOutput: summary.daily.reduce((s, d) => s + d.output, 0),
          totalCacheRead: summary.daily.reduce((s, d) => s + d.cache.input, 0),
          totalCacheWrite: summary.daily.reduce((s, d) => s + d.cache.output, 0),
          insights: summary.insights ? {
            streaks: summary.insights.streaks,
            mostUsedModel: summary.insights.mostUsedModel
              ? { name: summary.insights.mostUsedModel.name, tokens: summary.insights.mostUsedModel.tokens.total }
              : undefined,
          } : undefined,
          yesterdayHourly: (() => {
            const yesterday = new Date()
            yesterday.setDate(yesterday.getDate() - 1)
            const yesterdayKey = formatDate(yesterday)
            return summary.daily.find(d => d.date === yesterdayKey)?.hourly || []
          })(),
          colors: meta.colors[mode],
        })
      } catch (e) {
        this.outputChannel.appendLine(`[SlopMeter] Failed to load ${providerId}: ${e}`)
        console.error(`Failed to load ${providerId}:`, e)
      }
    }

    // Log cache stats
    const stats = this.cache.getStats()
    this.outputChannel.appendLine(
      `[SlopMeter] Cache: ${stats.hits} hits, ${stats.misses} misses (${(stats.hitRate * 100).toFixed(1)}%), ${stats.size} entries`
    )

    const payload: HeatmapPayload = {
      sections,
      year: this.currentYear,
      month: this.currentMonth,
      isCurrentMonth,
      colorMode: mode,
    }
    this.view.webview.postMessage({ type: 'update', data: payload })
  }
}
