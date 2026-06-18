import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const PLATFORM = process.platform

function firstExisting(...candidates: string[]): string | null {
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p
    } catch {
      // permission denied, etc.
    }
  }
  return null
}

export function getOpenCodeCandidates(): string[] {
  const home = os.homedir()
  const paths: string[] = []
  if (process.env.OPENCODE_DATA_DIR) paths.push(process.env.OPENCODE_DATA_DIR)
  if (PLATFORM === 'win32') {
    paths.push(path.join(process.env.APPDATA || '', 'opencode'))
    paths.push(path.join(process.env.LOCALAPPDATA || '', 'opencode'))
    paths.push(path.join(home, '.opencode'))
  } else if (PLATFORM === 'darwin') {
    paths.push(path.join(home, 'Library', 'Application Support', 'opencode'))
    paths.push(path.join(home, '.local', 'share', 'opencode'))
    paths.push(path.join(home, '.opencode'))
  } else {
    paths.push(path.join(home, '.local', 'share', 'opencode'))
    paths.push(path.join(home, '.opencode'))
  }
  return paths
}

export function findOpenCodeDir(customPath?: string): string | null {
  if (customPath) return fs.existsSync(customPath) ? customPath : null
  return firstExisting(...getOpenCodeCandidates())
}

export function getClaudeCandidates(): string[] {
  const home = os.homedir()
  if (PLATFORM === 'win32') {
    return [path.join(home, '.claude')]
  }
  if (PLATFORM === 'darwin') {
    return [
      path.join(home, '.claude'),
      path.join(home, 'Library', 'Application Support', 'Claude'),
    ]
  }
  return [path.join(home, '.claude')]
}

export function findClaudeDir(customPath?: string): string | null {
  if (customPath) return fs.existsSync(customPath) ? customPath : null
  return firstExisting(...getClaudeCandidates())
}

export function getHermesCandidates(): string[] {
  const home = os.homedir()
  return [path.join(home, '.hermes')]
}

export function findHermesDir(customPath?: string): string | null {
  if (customPath) return fs.existsSync(customPath) ? customPath : null
  return firstExisting(...getHermesCandidates())
}

export function tryMtime(filePath: string): number {
  try {
    if (!fs.existsSync(filePath)) return 0
    return fs.statSync(filePath).mtimeMs
  } catch {
    return 0
  }
}
