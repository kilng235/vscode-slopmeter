import * as vscode from 'vscode'
import { SlopMeterPanel } from './webview/panel'
import { refreshRegistry, setExtensionUri } from './providers'

let panel: SlopMeterPanel | undefined
let refreshTimer: NodeJS.Timeout | undefined

export function activate(context: vscode.ExtensionContext) {
  setExtensionUri(context.extensionUri.fsPath)
  panel = new SlopMeterPanel(context.extensionUri)

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SlopMeterPanel.viewType, panel)
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('slopMeter.refresh', () => {
      panel?.refresh()
    })
  )

  context.subscriptions.push(
    vscode.window.onDidChangeActiveColorTheme(() => {
      panel?.refresh()
    })
  )

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('slopMeter')) {
        const config = vscode.workspace.getConfiguration('slopMeter')
        refreshRegistry({
          opencode: config.get<string>('openCodePath', ''),
          claude: config.get<string>('claudePath', ''),
          hermes: config.get<string>('hermesPath', ''),
        })
        panel?.refresh()
      }
    })
  )

  const config = vscode.workspace.getConfiguration('slopMeter')
  const interval = config.get<number>('refreshInterval', 0)
  if (interval > 0) {
    refreshTimer = setInterval(() => panel?.refresh(), interval * 1000)
  }
}

export function deactivate() {
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = undefined
  }
  panel = undefined
}
