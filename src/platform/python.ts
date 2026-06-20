import { execSync, execFile } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
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

const execFileAsync = promisify(execFile)

export async function runPythonScript(
  pythonPath: string,
  scriptContent: string,
  args: string[] = [],
  timeoutMs: number = 15000
): Promise<string> {
  const tmpFile = path.join(os.tmpdir(), `slopmeter_${Date.now()}.py`)
  try {
    fs.writeFileSync(tmpFile, scriptContent, 'utf-8')
    const { stdout } = await execFileAsync(pythonPath, [tmpFile, ...args], {
      timeout: timeoutMs,
      maxBuffer: 50 * 1024 * 1024,
    })
    return stdout
  } finally {
    try { fs.unlinkSync(tmpFile) } catch {}
  }
}
