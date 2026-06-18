# SlopMeter

Track your AI coding tool usage with beautiful heatmaps in VSCode sidebar.

## Features

- 📊 Monthly heatmap calendar for AI usage
- 🔄 Auto-detect OpenCode, Claude Code, Hermes Agent data
- 🎨 Provider-specific color schemes
- 📱 Compact sidebar view
- 🔍 Detailed input/output/cache token breakdown

## Supported Agents

| Agent | Linux | macOS | Windows | Custom Path |
|-------|-------|-------|---------|-------------|
| OpenCode | `~/.local/share/opencode/` | `~/Library/Application Support/opencode/` | `%APPDATA%\opencode\` | `slopMeter.openCodePath` |
| Claude Code | `~/.claude/` | `~/.claude/` | `%USERPROFILE%\.claude\` | `slopMeter.claudePath` |
| Hermes Agent | `~/.hermes/` | `~/.hermes/` | `%USERPROFILE%\.hermes\` | `slopMeter.hermesPath` |

Data directories are auto-detected. If none found, the provider section shows as unavailable.

## Requirements

- VSCode 1.85+
- **Optional**: Python 3.7+ for better SQLite WAL support (recommended)

Without Python, the extension falls back to reading SQLite databases directly, which may miss the most recent few seconds of data in some cases.

## Installation

### From VSIX
1. Download the latest `.vsix` from [Releases](https://github.com/kilng235/vscode-slopmeter/releases)
2. In VSCode: Extensions → ... → Install from VSIX...
3. Reload window

### From Marketplace (coming soon)

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `slopMeter.providers` | `["opencode","claude","hermes"]` | Which providers to display |
| `slopMeter.colorMode` | `"auto"` | Dark/light theme |
| `slopMeter.openCodePath` | `""` | Custom OpenCode data path |
| `slopMeter.claudePath` | `""` | Custom Claude Code data path |
| `slopMeter.hermesPath` | `""` | Custom Hermes Agent data path |

## Data Privacy

All data is read from your local machine only. This extension:
- ❌ Makes no network requests
- ❌ Sends no telemetry
- ❌ Stores no data externally
- ✅ All data stays in your VSCode local storage

Check the CSP in `webview-ui/index.html` to verify: `default-src 'none'`

## Development

```bash
git clone https://github.com/kilng235/vscode-slopmeter.git
cd vscode-slopmeter
npm install
npm run compile
```

To test locally, press `F5` in VSCode to launch an Extension Development Host.

## License

MIT
