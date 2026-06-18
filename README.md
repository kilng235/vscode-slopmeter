# SlopMeter

在 VSCode 侧边栏跟踪 AI 编码工具的使用量热力图。

## 功能特性

- 📊 按月日历热力图展示 AI 工具使用情况
- 🔄 自动检测 OpenCode、Claude Code、Hermes Agent 数据目录
- 🎨 不同 Agent 专属配色方案
- 📱 紧凑型侧边栏视图
- 🔍 输入 / 输出 / 缓存 Token 分类统计

## 支持的 Agent

| Agent | Linux | macOS | Windows | 自定义路径 |
|-------|-------|-------|---------|-----------|
| OpenCode | `~/.local/share/opencode/` | `~/Library/Application Support/opencode/` | `%APPDATA%\opencode\` | `slopMeter.openCodePath` |
| Claude Code | `~/.claude/` | `~/.claude/` | `%USERPROFILE%\.claude\` | `slopMeter.claudePath` |
| Hermes Agent | `~/.hermes/` | `~/.hermes/` | `%USERPROFILE%\.hermes\` | `slopMeter.hermesPath` |

数据目录自动检测。如果找不到对应目录，该 Agent 板块会显示"暂无数据"。

## 系统要求

- VSCode 1.85+
- **可选**：Python 3.7+（推荐，用于更好读取 SQLite WAL 数据）

没有 Python 时，扩展会自动降级为直接读取 SQLite 数据库，可能缺少最新几秒钟的数据。

## 安装方法

### 从 VSIX 安装
1. 从 [Releases](https://github.com/kilng235/vscode-slopmeter/releases) 下载最新 `.vsix`
2. 在 VSCode 中：扩展 → ... → 从 VSIX 安装...
3. 重载窗口

### 从应用商店安装（即将推出）

## 配置项

| 设置 | 默认值 | 说明 |
|------|--------|------|
| `slopMeter.providers` | `["opencode","claude","hermes"]` | 显示哪些 Agent |
| `slopMeter.colorMode` | `"auto"` | 深色/浅色主题 |
| `slopMeter.openCodePath` | `""` | 自定义 OpenCode 数据路径 |
| `slopMeter.claudePath` | `""` | 自定义 Claude Code 数据路径 |
| `slopMeter.hermesPath` | `""` | 自定义 Hermes Agent 数据路径 |

## 数据隐私

所有数据仅在本地读取，扩展：

- ❌ 不发起任何网络请求
- ❌ 不发送任何遥测数据
- ❌ 不存储任何数据到外部
- ✅ 所有数据都在你的 VSCode 本地存储中

验证：`webview-ui/index.html` 中的 CSP 设置为 `default-src 'none'`

## 开发

```bash
git clone https://github.com/kilng235/vscode-slopmeter.git
cd vscode-slopmeter
npm install
npm run compile
```

本地测试：在 VSCode 中按 `F5` 启动扩展开发主机。

## 许可证

MIT
