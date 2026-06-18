import { execSync } from 'child_process'

let _pythonCmd: string | null = null

export function findPython(): string {
  if (_pythonCmd !== null) return _pythonCmd

  const candidates = process.platform === 'win32'
    ? ['python', 'py -3', 'python3']
    : ['python3', 'python']

  for (const cmd of candidates) {
    try {
      execSync(`${cmd} --version`, { stdio: 'ignore', timeout: 3000 })
      _pythonCmd = cmd
      return cmd
    } catch {
      continue
    }
  }

  _pythonCmd = ''
  return ''
}

export function isPythonAvailable(): boolean {
  return findPython() !== ''
}
