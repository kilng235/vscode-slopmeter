export interface CacheTokens {
  input: number
  output: number
}

export interface TokenTotals {
  input: number
  output: number
  cache: CacheTokens
  total: number
}

export interface ModelUsage {
  name: string
  tokens: TokenTotals
}

export interface DailyUsage {
  date: string
  input: number
  output: number
  cache: CacheTokens
  total: number
  breakdown: ModelUsage[]
  displayValue?: number
}

export interface Streaks {
  longest: number
  current: number
}

export interface Insights {
  streaks: Streaks
  mostUsedModel?: ModelUsage
  recentMostUsedModel?: ModelUsage
}

export interface UsageSummary {
  provider: ProviderId
  daily: DailyUsage[]
  insights?: Insights
  totalTokens: number
}

export type ProviderId = 'opencode' | 'claude' | 'hermes' | 'codex' | 'cursor' | 'gemini' | 'pi' | 'amp' | 'all'

export type ColorMode = 'light' | 'dark'

export interface ProviderConfig {
  id: ProviderId
  name: string
  enabled: boolean
}

export const PROVIDER_META: Record<ProviderId, { name: string; colors: Record<ColorMode, string[]> }> = {
  opencode: {
    name: 'Open Code',
    colors: {
      light: ['#f5f5f5', '#d4d4d4', '#a3a3a3', '#525252', '#171717'],
      dark: ['#262626', '#525252', '#737373', '#a3a3a3', '#fafafa'],
    },
  },
  claude: {
    name: 'Claude Code',
    colors: {
      light: ['#f0fdf4', '#bbf7d0', '#4ade80', '#16a34a', '#14532d'],
      dark: ['#1a2e1a', '#14532d', '#16a34a', '#4ade80', '#86efac'],
    },
  },
  hermes: {
    name: 'Hermes Agent',
    colors: {
      light: ['#f5f3ff', '#e9d5ff', '#c4b5fd', '#8b5cf6', '#5b21b6'],
      dark: ['#2e1065', '#4c1d95', '#6d28d9', '#8b5cf6', '#d8b4fe'],
    },
  },
  codex: {
    name: 'Codex',
    colors: {
      light: ['#e0e7ff', '#a5b4fc', '#818cf8', '#4f46e5', '#312e81'],
      dark: ['#1e1b4b', '#312e81', '#4338ca', '#818cf8', '#c7d2fe'],
    },
  },
  cursor: {
    name: 'Cursor',
    colors: {
      light: ['#fff7ed', '#fed7aa', '#fdba74', '#f97316', '#9a3412'],
      dark: ['#431407', '#9a3412', '#c2410c', '#f97316', '#fdba74'],
    },
  },
  gemini: {
    name: 'Gemini CLI',
    colors: {
      light: ['#eff6ff', '#bfdbfe', '#93c5fd', '#3b82f6', '#1d4ed8'],
      dark: ['#172554', '#1d4ed8', '#2563eb', '#60a5fa', '#bfdbfe'],
    },
  },
  pi: {
    name: 'Pi Coding Agent',
    colors: {
      light: ['#ecfdf5', '#a7f3d0', '#6ee7b7', '#10b981', '#047857'],
      dark: ['#022c22', '#065f46', '#059669', '#34d399', '#a7f3d0'],
    },
  },
  amp: {
    name: 'Amp',
    colors: {
      light: ['#ecfeff', '#a5f3fc', '#67e8f9', '#06b6d4', '#0e7490'],
      dark: ['#083344', '#155e75', '#0891b2', '#22d3ee', '#a5f3fc'],
    },
  },
  all: {
    name: 'All Providers',
    colors: {
      light: ['#f0fdf4', '#bbf7d0', '#4ade80', '#16a34a', '#14532d'],
      dark: ['#052e16', '#15803d', '#16a34a', '#4ade80', '#bbf7d0'],
    },
  },
}
