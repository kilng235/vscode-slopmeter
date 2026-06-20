import { execSync } from 'child_process'
import * as vscode from 'vscode'

let _pythonCmd: string | null = null
let _pythonNoticeShown = false

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

export function showPythonNotice(): void {
  if (_pythonNoticeShown) return
  _pythonNoticeShown = true
  try {
    vscode.window.showInformationMessage(
      'SlopMeter: 未找到 Python，SQLite 读取将降级（可能缺少最新几秒数据）。安装 Python 3.7+ 可提升读取质量。',
      '知道了'
    )
  } catch {
    // running outside VSCode (tests)
  }
}
