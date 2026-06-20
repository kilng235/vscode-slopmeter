# Changelog

## 0.3.0

- 所有 Provider 改用异步 Python 执行（`runPythonScript`），不再阻塞主线程
- OpenCode / Hermes 新增 sql.js 降级回退（Python 不可用时自动切换）
- 修复 Token 重复计算：`inputTokens` 不再包含 cache read/write，避免输入与缓存统计重叠
- 修复定时器内存泄漏：`deactivate` 时正确清理 `setInterval`
- 移除未实现的 Export 命令
- 清理未使用的 Provider 类型（codex / cursor / gemini / pi / amp 拆分为 `PlannedProviderId`）
- 新增 vitest 单元测试（utils + aggregator）

## 0.2.0

- 跨平台支持（Linux、macOS、Windows）
- 自动检测所有 Agent 的数据目录
- 动态 Python 检测（全平台通用）
- Python 提示通知（未安装时提示一次）
- 移除 better-sqlite3 依赖（无需原生编译）
- 输入 / 输出 / 缓存 Token 分类展示
- 按月日历热力图
- 数据缓存（切月份秒开）
- README 改为中文

## 0.1.0

- 初始版本
- 支持 OpenCode、Claude Code、Hermes Agent
- 手动刷新
