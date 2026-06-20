# vscode-slopmeter 渐进重构 — 剩余任务实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 vscode-slopmeter 剩余的重构任务（Hermes 异步化、Token 计算 Bug、内存泄漏、代码清理）。

**已完成的上下文：**
- `src/platform/python.ts` 已新增 `runPythonScript` 异步函数（commit `79f95ce`）
- `src/providers/opencode.ts` 已改用异步 Python + sql.js 日期过滤（commit `13e72f1`, `7e63396`）

**Tech Stack:** TypeScript 5.3, VS Code Extension API, sql.js, vitest（测试）

## 全局约束

- VS Code 引擎版本: `^1.85.0`
- TypeScript target: `ES2022`
- 模块系统: `CommonJS`
- 不引入新依赖（除 vitest 用于 Task 9 测试）
- 所有 Provider 必须保持 `IProvider` 接口兼容
- 每次修改后必须 `npm run compile` 验证
- 工作目录: `/mnt/e/1/Juno/vscode-slopmeter`

---

## Task 3: Hermes Provider 异步化 + sql.js 回退

**目标**: Hermes Provider 改用异步 Python 执行，并添加 sql.js 降级回退。

**文件:**
- 修改: `src/providers/hermes.ts`

**接口:**
- 消费: `runPythonScript` from `src/platform/python.ts`

**注意**: Hermes 的 `started_at` 字段是**秒级**时间戳，代码中统一用 `started_at * 1000 >= ? AND started_at * 1000 <= ?` 与毫秒参数比较。

- [ ] **Step 1: 修改 `loadSessions` 为 async，使用 `runPythonScript`**

将 `loadSessions` 替换为：

```typescript
private async loadSessions(dbPath: string, startMs: number, endMs: number): Promise<HermesSession[]> {
  const pythonCmd = findPython()
  if (!pythonCmd) {
    showPythonNotice()
    console.error('Hermes Python not available, trying sql.js fallback')
    return await this.loadViaSqlJsFallback(dbPath, startMs, endMs)
  }

  try {
    const { runPythonScript } = await import('../platform/python')
    const pyCode = `
import sqlite3, json, sys, os, shutil, tempfile
db, s, e = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
d = tempfile.mkdtemp(prefix='sm-')
t = os.path.join(d, 'state.db')
shutil.copy2(db, t)
for x in ['-wal', '-shm']:
    p = db + x
    if os.path.exists(p): shutil.copy2(p, t + x)
c = sqlite3.connect('file:' + t + '?mode=ro', uri=True)
r = c.execute(
    """SELECT id, model, started_at, input_tokens, output_tokens,
              cache_read_tokens, cache_write_tokens, reasoning_tokens,
              message_count
       FROM sessions
       WHERE started_at * 1000 >= ? AND started_at * 1000 <= ?
         AND (input_tokens > 0 OR output_tokens > 0
              OR cache_read_tokens > 0 OR cache_write_tokens > 0)""",
    [s, e])
M = []
for row in r:
    M.append({
        'id': row[0],
        'model': row[1] or '',
        'started_at': row[2],
        'input_tokens': row[3] or 0,
        'output_tokens': row[4] or 0,
        'cache_read_tokens': row[5] or 0,
        'cache_write_tokens': row[6] or 0,
        'reasoning_tokens': row[7] or 0,
        'message_count': row[8] or 0
    })
c.close()
shutil.rmtree(d, ignore_errors=True)
json.dump(M, sys.stdout)
`
    const result = await runPythonScript(
      pythonCmd,
      pyCode,
      [dbPath, String(startMs), String(endMs)],
      30000
    )
    const rows = JSON.parse(result)
    const sessions: HermesSession[] = []
    for (const row of rows) {
      if (row && typeof row === 'object') {
        sessions.push(row as HermesSession)
      }
    }
    return sessions
  } catch (e) {
    console.error('Hermes Python script failed, trying sql.js fallback:', e)
    return await this.loadViaSqlJsFallback(dbPath, startMs, endMs)
  }
}
```

- [ ] **Step 2: 新增 `loadViaSqlJsFallback` 方法**

```typescript
private async loadViaSqlJsFallback(dbPath: string, startMs: number, endMs: number): Promise<HermesSession[]> {
  try {
    const initSqlJs = require('sql.js')
    const buffer = fs.readFileSync(dbPath)
    const SQL = await initSqlJs()
    const db = new SQL.Database(buffer)

    const stmt = db.prepare(`
      SELECT id, model, started_at, input_tokens, output_tokens,
             cache_read_tokens, cache_write_tokens, reasoning_tokens,
             message_count
      FROM sessions
      WHERE started_at * 1000 >= ? AND started_at * 1000 <= ?
    `)
    stmt.bind([startMs, endMs])

    const sessions: HermesSession[] = []
    while (stmt.step()) {
      const row = stmt.get()
      sessions.push({
        id: row[0] || '',
        model: row[1] || '',
        started_at: row[2] || 0,
        input_tokens: row[3] || 0,
        output_tokens: row[4] || 0,
        cache_read_tokens: row[5] || 0,
        cache_write_tokens: row[6] || 0,
        reasoning_tokens: row[7] || 0,
        message_count: row[8] || 0,
      })
    }
    stmt.free()
    db.close()
    return sessions
  } catch (e) {
    console.error('Hermes sql.js fallback failed:', e)
    return []
  }
}
```

- [ ] **Step 3: 更新 `loadData` 签名**

```typescript
async loadData(start: Date, end: Date): Promise<UsageSummary> {
  const baseDir = this.getBaseDir()
  const dbPath = path.join(baseDir, 'state.db')

  if (!fs.existsSync(dbPath)) {
    return { provider: 'hermes', daily: [], insights: undefined, totalTokens: 0 }
  }

  const startMs = start.getTime()
  const endMs = end.getTime()
  const sessions = await this.loadSessions(dbPath, startMs, endMs)
  const entries = this.normalizeEntries(sessions, start, end)
  return aggregateEntries('hermes', entries, start, end)
}
```

- [ ] **Step 4: 删除旧的 `execSync` 相关代码**

移除 `execSync` + tmp-script-write + manual cleanup 的旧逻辑块（`loadSessions` 的旧实现）。

- [ ] **Step 5: 验证编译**

Run: `npm run compile` — Expected: 无 TS 错误

- [ ] **Step 6: Commit**

```bash
git commit -m "refactor(hermes): async python execution + sql.js fallback"
```

---

## Task 4: 修复 Token 重复计算 Bug

**目标**: `inputTokens` 不应包含 cache read/write，避免界面上"输入"和"缓存"统计重叠。

**文件:**
- 修改: `src/providers/opencode.ts`
- 修改: `src/providers/claude.ts`
- 修改: `src/providers/hermes.ts`

- [ ] **Step 1: 修复 `opencode.ts`**

将 `normalizeEntries` 中的：
```typescript
const inputTokens = (tokens.input || 0) + (tokens.cache?.read || 0) + (tokens.cache?.write || 0)
```
改为：
```typescript
const inputTokens = tokens.input || 0
```

- [ ] **Step 2: 修复 `claude.ts`**

将 `normalizeEntries` 中的：
```typescript
inputTokens: inputTokens + cacheRead + cacheWrite,
```
改为：
```typescript
inputTokens,
```

- [ ] **Step 3: 修复 `hermes.ts`**

将 `normalizeEntries` 中的：
```typescript
const inputTokens = session.input_tokens + session.cache_read_tokens + session.cache_write_tokens
```
改为：
```typescript
const inputTokens = session.input_tokens
```

- [ ] **Step 4: 编译验证**

Run: `npm run compile` — Expected: 无 TS 错误

- [ ] **Step 5: Commit**

```bash
git commit -m "fix(providers): separate cache tokens from input tokens"
```

---

## Task 5: 修复定时器内存泄漏 + 移除 Export 命令

**目标**: 保存 `setInterval` 句柄以便清理，移除未实现的 export 命令。

**文件:**
- 修改: `src/extension.ts`
- 修改: `package.json`

- [ ] **Step 1: 修改 `src/extension.ts`**

添加模块级变量：
```typescript
let panel: SlopMeterPanel | undefined
let refreshTimer: NodeJS.Timeout | undefined
```

修改 activate 中的定时器：
```typescript
if (interval > 0) {
  refreshTimer = setInterval(() => panel?.refresh(), interval * 1000)
}
```

修改 deactivate：
```typescript
export function deactivate() {
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = undefined
  }
  panel = undefined
}
```

同时**删除**整个 `slopMeter.export` 的 `registerCommand` 块（第21-29行）。

- [ ] **Step 2: 修改 `package.json`**

从 `commands` 数组中移除：
```json
{
  "command": "slopMeter.export",
  "title": "SlopMeter: Export Heatmap",
  "icon": "$(export)"
}
```

从 `activationEvents` 中移除 `"onCommand:slopMeter.export"`。

- [ ] **Step 3: 编译验证**

Run: `npm run compile` — Expected: 无 TS 错误

- [ ] **Step 4: Commit**

```bash
git commit -m "fix(extension): fix timer leak, remove unimplemented export command"
```

---

## Task 6: 清理未实现 ProviderId + 未使用 Import

**目标**: 清理类型系统中未实现的 Provider，删除死代码。

**文件:**
- 修改: `src/models.ts`
- 修改: `src/providers/opencode.ts`
- 修改: `src/providers/hermes.ts`

- [ ] **Step 1: 修改 `src/models.ts`**

将：
```typescript
export type ProviderId = 'opencode' | 'claude' | 'hermes' | 'codex' | 'cursor' | 'gemini' | 'pi' | 'amp' | 'all'
```
改为：
```typescript
export type ProviderId = 'opencode' | 'claude' | 'hermes' | 'all'
export type PlannedProviderId = 'codex' | 'cursor' | 'gemini' | 'pi' | 'amp'
```

同时调整 `PROVIDER_META` 类型以兼容两种类型：
```typescript
export const PROVIDER_META: Record<ProviderId | PlannedProviderId, { name: string; colors: Record<ColorMode, string[]> }> = {
```

- [ ] **Step 2: 删除未使用的 `tryMtime` import**

`opencode.ts` 中将 `import { findOpenCodeDir, tryMtime }` → `import { findOpenCodeDir }`

`hermes.ts` 中将 `import { findHermesDir, tryMtime }` → `import { findHermesDir }`

- [ ] **Step 3: 编译验证**

Run: `npm run compile` — Expected: 无 TS 错误

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: clean up unused ProviderId types and imports"
```

---

## Task 7: 移除 ESLint 脚本

**目标**: 删除无依赖的 lint 脚本。

**文件:**
- 修改: `package.json`

- [ ] **Step 1: 从 `scripts` 中移除 lint**

删除 `"lint": "eslint src --ext ts"`

- [ ] **Step 2: Commit**

```bash
git commit -m "chore: remove unused lint script"
```

---

## Task 8: 验证整体功能

**目标**: 确保所有重构后扩展能正常工作。

- [ ] **Step 1: 编译**

Run: `npm run compile` — Expected: 无 TS 错误

- [ ] **Step 2: 查看提交历史**

```bash
git log --oneline -10
```

确认所有重构 commit 按序排列。

---

## 可选 Task 9: 添加单元测试（阶段四）

**目标**: 为核心工具函数和聚合逻辑添加测试。

**文件:**
- 新增: `src/test/utils.test.ts`
- 新增: `src/test/aggregator.test.ts`
- 修改: `package.json`

- [ ] **Step 1: 安装 vitest**

Run: `npm install -D vitest`

- [ ] **Step 2: 添加 test 脚本到 `package.json`**

```json
"test": "vitest run"
```

- [ ] **Step 3: 编写 `src/test/utils.test.ts`**

```typescript
import { describe, it, expect } from 'vitest'
import { formatDate, parseTimestamp, getHeatmapLevel, computeLongestStreak, computeCurrentStreak, formatTokenTotal } from '../utils'

describe('formatDate', () => {
  it('formats date correctly', () => {
    expect(formatDate(new Date(2024, 0, 15))).toBe('2024-01-15')
  })
})

describe('parseTimestamp', () => {
  it('parses seconds timestamp', () => {
    const result = parseTimestamp(1705276800)
    expect(result).not.toBeNull()
    expect(result!.getFullYear()).toBe(2024)
  })

  it('parses milliseconds timestamp', () => {
    const result = parseTimestamp(1705276800000)
    expect(result).not.toBeNull()
    expect(result!.getFullYear()).toBe(2024)
  })

  it('returns null for undefined', () => {
    expect(parseTimestamp(undefined)).toBeNull()
  })
})

describe('getHeatmapLevel', () => {
  it('returns 0 for zero or negative values', () => {
    expect(getHeatmapLevel(0, 100)).toBe(0)
    expect(getHeatmapLevel(-1, 100)).toBe(0)
  })

  it('returns top level for max value', () => {
    expect(getHeatmapLevel(100, 100)).toBe(4)
  })
})

describe('formatTokenTotal', () => {
  it('formats large numbers with suffix', () => {
    expect(formatTokenTotal(1500)).toBe('1.5K')
    expect(formatTokenTotal(1500000)).toBe('1.5M')
  })

  it('formats small numbers as-is', () => {
    expect(formatTokenTotal(999)).toBe('999')
  })
})
```

- [ ] **Step 4: 编写 `src/test/aggregator.test.ts`**

```typescript
import { describe, it, expect } from 'vitest'
import { aggregateEntries, NormalizedEntry } from '../providers/aggregator'

describe('aggregateEntries', () => {
  it('returns empty for empty entries', () => {
    const start = new Date('2024-01-01')
    const end = new Date('2024-01-31')
    const result = aggregateEntries('opencode', [], start, end)
    expect(result.daily).toEqual([])
    expect(result.totalTokens).toBe(0)
  })

  it('aggregates single day entries', () => {
    const start = new Date('2024-01-01')
    const end = new Date('2024-01-31')
    const entries: NormalizedEntry[] = [{
      timestamp: new Date('2024-01-15T10:00:00').getTime(),
      inputTokens: 100, outputTokens: 50, cacheRead: 10, cacheWrite: 5,
      modelName: 'gpt-4'
    }]
    const result = aggregateEntries('opencode', entries, start, end)
    expect(result.daily.length).toBe(1)
    expect(result.daily[0].total).toBe(150)
    expect(result.daily[0].input).toBe(100)
    expect(result.daily[0].output).toBe(50)
  })

  it('filters entries outside date range', () => {
    const start = new Date('2024-01-01')
    const end = new Date('2024-01-31')
    const entries: NormalizedEntry[] = [{
      timestamp: new Date('2023-12-15').getTime(),
      inputTokens: 100, outputTokens: 50, cacheRead: 0, cacheWrite: 0,
      modelName: 'gpt-4'
    }]
    const result = aggregateEntries('opencode', entries, start, end)
    expect(result.daily.length).toBe(0)
  })
})
```

- [ ] **Step 5: 运行测试**

Run: `npm test` — Expected: 所有测试通过

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "test: add vitest unit tests for utils and aggregator"
```
