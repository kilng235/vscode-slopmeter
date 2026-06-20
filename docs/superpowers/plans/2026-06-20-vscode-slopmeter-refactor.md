# vscode-slopmeter 渐进重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 vscode-slopmeter 扩展中的阻塞 I/O、数据计算 Bug、内存泄漏和残留功能，提升代码质量和用户体验。

**Architecture:** 保持现有 Provider + Aggregator 架构不变，将同步 `execSync` 改为异步 `execFile`，修复数据归一化逻辑，清理未实现功能和死代码。

**Tech Stack:** TypeScript 5.3, VS Code Extension API, sql.js, vitest（测试）

## 全局约束

- VS Code 引擎版本: `^1.85.0`
- TypeScript target: `ES2022`
- 模块系统: `CommonJS`
- 不引入新依赖（除 vitest 用于阶段四测试）
- 所有 Provider 必须保持 `IProvider` 接口兼容
- 每次修改后必须 `npm run compile` 验证无 TS 错误

---

## 文件结构映射

| 文件 | 状态 | 职责 |
|------|------|------|
| `src/platform/python.ts` | 修改 | 新增异步 `runPythonScript`，保留 `findPython`/`showPythonNotice` |
| `src/providers/opencode.ts` | 修改 | 改用 `runPythonScript`，修复 sql.js fallback 日期过滤，修复 Token 计算 |
| `src/providers/hermes.ts` | 修改 | 改用 `runPythonScript`，新增 sql.js fallback，修复 Token 计算 |
| `src/providers/claude.ts` | 修改 | 修复 Token 计算 |
| `src/extension.ts` | 修改 | 修复定时器内存泄漏，移除 export 命令注册 |
| `src/models.ts` | 修改 | 拆分 `ProviderId`，清理未实现项 |
| `package.json` | 修改 | 移除 `lint` 脚本和 `slopMeter.export` 命令 |
| `src/providers/opencode.ts` | 修改 | 删除未使用的 `tryMtime` import |
| `src/providers/hermes.ts` | 修改 | 删除未使用的 `tryMtime` import |
| `src/test/utils.test.ts` | 新增（可选） | utils 函数单元测试 |
| `src/test/aggregator.test.ts` | 新增（可选） | 聚合逻辑单元测试 |

---

## Task 1: 新增异步 Python 脚本执行器

**目标**: 将 `execSync` 替换为异步 `execFile`，避免阻塞 VS Code UI。

**文件:**
- 修改: `src/platform/python.ts`

**接口:**
- 新增: `runPythonScript(pythonPath: string, scriptContent: string, args: string[], timeoutMs: number): Promise<string>`

- [ ] **Step 1: 修改 `src/platform/python.ts`，新增 `runPythonScript`**

```typescript
import { execFile } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

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
```

- [ ] **Step 2: 验证编译**

Run: `npm run compile`
Expected: 无错误（仅新增未使用的函数，不影响现有代码）

- [ ] **Step 3: Commit**

```bash
git add src/platform/python.ts
git commit -m "feat(platform): add async runPythonScript to replace execSync"
```

---

## Task 2: OpenCode Provider 异步化 + sql.js 日期过滤

**目标**: OpenCode Provider 改用异步 Python 执行，并修复 sql.js fallback 的日期过滤。

**文件:**
- 修改: `src/providers/opencode.ts`

**接口:**
- 消费: `runPythonScript` from `src/platform/python.ts`
- 修改: `loadViaSqlJs(dbPath, startMs, endMs)` -> `loadViaSqlJsAsync(dbPath, startMs, endMs)`
- 修改: `loadViaSqlJsFallback(dbPath)` -> `loadViaSqlJsFallback(dbPath, startMs, endMs)`

- [ ] **Step 1: 修改 `loadViaSqlJs` 为 async，使用 `runPythonScript`**

将 `opencode.ts` 中的 `loadViaSqlJs` 方法替换为：

```typescript
private async loadViaSqlJsAsync(dbPath: string, startMs: number, endMs: number): Promise<OpenCodeMessage[]> {
  const pythonCmd = findPython()
  if (!pythonCmd) {
    showPythonNotice()
    return await this.loadViaSqlJsFallback(dbPath, startMs, endMs)
  }

  try {
    const { runPythonScript } = await import('../platform/python')
    const pyCode = `
import sqlite3, json, sys, os, shutil, tempfile
db, s, e = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
d = tempfile.mkdtemp(prefix='sm-')
t = os.path.join(d, 'opencode.db')
shutil.copy2(db, t)
for x in ['-wal', '-shm']:
    p = db + x
    if os.path.exists(p): shutil.copy2(p, t + x)
c = sqlite3.connect('file:' + t + '?mode=ro', uri=True)
r = c.execute("SELECT id, data FROM message WHERE time_created >= ? AND time_created <= ?", [s, e])
M = []
for i, d in r:
    try:
        m = json.loads(d); m['id'] = m.get('id') or str(i); M.append(m)
    except: pass
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
    const messages: OpenCodeMessage[] = []
    for (const row of rows) {
      if (row && typeof row === 'object') {
        messages.push(row as OpenCodeMessage)
      }
    }
    return messages
  } catch (e) {
    console.error('Python script failed, trying sql.js fallback:', e)
    return await this.loadViaSqlJsFallback(dbPath, startMs, endMs)
  }
}
```

- [ ] **Step 2: 修改 `loadViaSqlJsFallback` 添加日期过滤**

```typescript
private async loadViaSqlJsFallback(dbPath: string, startMs: number, endMs: number): Promise<OpenCodeMessage[]> {
  const initSqlJs = require('sql.js')
  const buffer = fs.readFileSync(dbPath)
  const SQL = await initSqlJs()
  const db = new SQL.Database(buffer)
  
  const startSec = Math.floor(startMs / 1000)
  const endSec = Math.floor(endMs / 1000)
  const stmt = db.prepare("SELECT id, data FROM message WHERE time_created >= ? AND time_created <= ? ORDER BY time_created ASC")
  stmt.bind([startSec, endSec])
  
  const messages: OpenCodeMessage[] = []
  while (stmt.step()) {
    const row = stmt.get()
    try {
      const id = row[0]
      const rawData = row[1]
      const data = JSON.parse(rawData)
      data.id = data.id || String(id)
      messages.push(data as OpenCodeMessage)
    } catch {
      // skip invalid rows
    }
  }
  stmt.free()
  db.close()
  return messages
}
```

- [ ] **Step 3: 更新 `loadFromDatabase` 调用签名**

```typescript
private async loadFromDatabase(dbPath: string, startMs: number, endMs: number): Promise<OpenCodeMessage[]> {
  try {
    return await this.loadViaSqlJsAsync(dbPath, startMs, endMs)
  } catch (e) {
    console.error('Failed to load database:', e)
    return []
  }
}
```

- [ ] **Step 4: 更新 `loadData` 中的调用**

```typescript
async loadData(start: Date, end: Date): Promise<UsageSummary> {
  const baseDir = this.getBaseDir()
  const dbPath = path.join(baseDir, 'opencode.db')

  let messages: OpenCodeMessage[] = []

  if (fs.existsSync(dbPath)) {
    const startMs = start.getTime()
    const endMs = end.getTime()
    messages = await this.loadFromDatabase(dbPath, startMs, endMs)
  }

  if (messages.length === 0) {
    const messagesDir = path.join(baseDir, 'storage', 'message')
    if (fs.existsSync(messagesDir)) {
      messages = this.loadFromFiles(messagesDir)
    }
  }

  const entries = this.normalizeEntries(messages, start, end)
  return aggregateEntries('opencode', entries, start, end)
}
```

- [ ] **Step 5: 验证编译**

Run: `npm run compile`
Expected: 无错误

- [ ] **Step 6: Commit**

```bash
git add src/providers/opencode.ts
git commit -m "refactor(opencode): async python execution + sql.js date filtering"
```

---

## Task 3: Hermes Provider 异步化 + sql.js 回退

**目标**: Hermes Provider 改用异步 Python 执行，并添加 sql.js fallback。

**文件:**
- 修改: `src/providers/hermes.ts`

**接口:**
- 消费: `runPythonScript` from `src/platform/python.ts`

- [ ] **Step 1: 修改 `loadSessions` 为 async，使用 `runPythonScript`**

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

- [ ] **Step 3: 更新 `loadData` 中的调用**

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

- [ ] **Step 4: 验证编译**

Run: `npm run compile`
Expected: 无错误

- [ ] **Step 5: Commit**

```bash
git add src/providers/hermes.ts
git commit -m "refactor(hermes): async python execution + sql.js fallback"
```

---

## Task 4: 修复 Token 重复计算 Bug（所有 Provider）

**目标**: `inputTokens` 不应包含 cache read/write，避免界面上输入/缓存统计重叠。

**文件:**
- 修改: `src/providers/opencode.ts`
- 修改: `src/providers/claude.ts`
- 修改: `src/providers/hermes.ts`

- [ ] **Step 1: 修复 `opencode.ts` 的 `normalizeEntries`**

找到：
```typescript
const inputTokens = (tokens.input || 0) + (tokens.cache?.read || 0) + (tokens.cache?.write || 0)
```

改为：
```typescript
const inputTokens = tokens.input || 0
```

- [ ] **Step 2: 修复 `claude.ts` 的 `normalizeEntries`**

找到：
```typescript
inputTokens: inputTokens + cacheRead + cacheWrite,
```

改为：
```typescript
inputTokens: inputTokens,
```
（其中 `inputTokens` 变量本身已经是不含 cache 的，因为之前提取逻辑是 `tok?.input || usage.input_tokens || meta.input_tokens || 0`）

- [ ] **Step 3: 修复 `hermes.ts` 的 `normalizeEntries`**

找到：
```typescript
const inputTokens = session.input_tokens + session.cache_read_tokens + session.cache_write_tokens
```

改为：
```typescript
const inputTokens = session.input_tokens
```

- [ ] **Step 4: 验证编译**

Run: `npm run compile`
Expected: 无错误

- [ ] **Step 5: Commit**

```bash
git add src/providers/opencode.ts src/providers/claude.ts src/providers/hermes.ts
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
const interval = config.get<number>('refreshInterval', 0)
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

删除 export 命令注册（整个 `slopMeter.export` 的 `registerCommand` 块）。

- [ ] **Step 2: 修改 `package.json`**

从 `commands` 数组中移除：
```json
{
  "command": "slopMeter.export",
  "title": "SlopMeter: Export Heatmap",
  "icon": "$(export)"
}
```

同时移除 `activationEvents` 中的 `"onCommand:slopMeter.export"`。

- [ ] **Step 3: 验证编译**

Run: `npm run compile`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add src/extension.ts package.json
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

同时需要调整 `PROVIDER_META` 的类型以兼容两种类型：
```typescript
export const PROVIDER_META: Record<ProviderId | PlannedProviderId, { name: string; colors: Record<ColorMode, string[]> }> = {
  // ... 保留所有现有定义
}
```

- [ ] **Step 2: 删除未使用的 `tryMtime` import**

在 `opencode.ts` 中，将：
```typescript
import { findOpenCodeDir, tryMtime } from '../platform/paths'
```
改为：
```typescript
import { findOpenCodeDir } from '../platform/paths'
```

在 `hermes.ts` 中，将：
```typescript
import { findHermesDir, tryMtime } from '../platform/paths'
```
改为：
```typescript
import { findHermesDir } from '../platform/paths'
```

- [ ] **Step 3: 验证编译**

Run: `npm run compile`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add src/models.ts src/providers/opencode.ts src/providers/hermes.ts
git commit -m "chore: clean up unused ProviderId types and imports"
```

---

## Task 7: 移除 ESLint 脚本

**目标**: `package.json` 有 lint 脚本但没装 ESLint，删除避免误导。

**文件:**
- 修改: `package.json`

- [ ] **Step 1: 修改 `package.json`**

从 `scripts` 中移除：
```json
"lint": "eslint src --ext ts"
```

- [ ] **Step 2: Commit**

```bash
git add package.json
git commit -m "chore: remove unused lint script"
```

---

## Task 8: 验证整体功能（关键）

**目标**: 确保所有修改后扩展能正常工作。

- [ ] **Step 1: 编译**

Run: `npm run compile`
Expected: 无 TypeScript 错误

- [ ] **Step 2: 手动测试清单**

启动 VS Code 扩展开发主机（`F5`），验证：
- [ ] 侧边栏 SlopMeter 面板正常显示
- [ ] 各 Provider 数据加载正确（有数据的月份）
- [ ] 切换月份正常
- [ ] 刷新按钮正常
- [ ] 深色/浅色主题切换正常
- [ ] Token 统计分类正确（输入、输出、缓存互不重叠）
- [ ] 刷新时 UI 不卡顿（异步化效果）

- [ ] **Step 3: 提交最终验证**

```bash
git log --oneline -10
```

Expected: 看到所有重构 commit

---

## 可选 Task 9: 添加单元测试（阶段四）

**目标**: 为核心工具函数和聚合逻辑添加测试。

**文件:**
- 新增: `package.json`（添加 vitest 依赖和 test 脚本）
- 新增: `src/test/utils.test.ts`
- 新增: `src/test/aggregator.test.ts`

- [ ] **Step 1: 安装 vitest**

Run:
```bash
npm install -D vitest
```

- [ ] **Step 2: 修改 `package.json` 添加 test 脚本**

```json
"scripts": {
  "vscode:prepublish": "npm run compile",
  "compile": "tsc -p ./",
  "watch": "tsc -watch -p ./",
  "test": "vitest run"
}
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

  it('returns null for invalid input', () => {
    expect(parseTimestamp(undefined)).toBeNull()
    expect(parseTimestamp('invalid')).toBeNull()
  })
})

describe('getHeatmapLevel', () => {
  it('returns 0 for zero or negative values', () => {
    expect(getHeatmapLevel(0, 100)).toBe(0)
    expect(getHeatmapLevel(-1, 100)).toBe(0)
  })

  it('returns correct level for proportional values', () => {
    expect(getHeatmapLevel(100, 100)).toBeGreaterThanOrEqual(3)
  })
})

describe('computeLongestStreak', () => {
  it('computes longest streak', () => {
    expect(computeLongestStreak(['2024-01-01', '2024-01-02', '2024-01-03'])).toBe(3)
    expect(computeLongestStreak(['2024-01-01', '2024-01-03'])).toBe(1)
  })
})

describe('computeCurrentStreak', () => {
  it('computes current streak ending today', () => {
    const today = new Date()
    const dates = [formatDate(today)]
    expect(computeCurrentStreak(dates, today)).toBe(1)
  })
})

describe('formatTokenTotal', () => {
  it('formats large numbers', () => {
    expect(formatTokenTotal(1500)).toBe('1.5K')
    expect(formatTokenTotal(1500000)).toBe('1.5M')
  })

  it('formats small numbers', () => {
    expect(formatTokenTotal(999)).toBe('999')
  })
})
```

- [ ] **Step 4: 编写 `src/test/aggregator.test.ts`**

```typescript
import { describe, it, expect } from 'vitest'
import { aggregateEntries, NormalizedEntry } from '../providers/aggregator'

describe('aggregateEntries', () => {
  it('aggregates empty entries', () => {
    const start = new Date('2024-01-01')
    const end = new Date('2024-01-31')
    const result = aggregateEntries('opencode', [], start, end)
    expect(result.daily).toEqual([])
    expect(result.totalTokens).toBe(0)
  })

  it('aggregates single day entries', () => {
    const start = new Date('2024-01-01')
    const end = new Date('2024-01-31')
    const entries: NormalizedEntry[] = [
      {
        timestamp: new Date('2024-01-15T10:00:00').getTime(),
        inputTokens: 100,
        outputTokens: 50,
        cacheRead: 10,
        cacheWrite: 5,
        modelName: 'gpt-4'
      }
    ]
    const result = aggregateEntries('opencode', entries, start, end)
    expect(result.daily.length).toBe(1)
    expect(result.daily[0].total).toBe(150)
    expect(result.daily[0].input).toBe(100)
    expect(result.daily[0].output).toBe(50)
    expect(result.totalTokens).toBe(150)
  })

  it('filters entries outside date range', () => {
    const start = new Date('2024-01-01')
    const end = new Date('2024-01-31')
    const entries: NormalizedEntry[] = [
      {
        timestamp: new Date('2023-12-15').getTime(),
        inputTokens: 100,
        outputTokens: 50,
        cacheRead: 0,
        cacheWrite: 0,
        modelName: 'gpt-4'
      }
    ]
    const result = aggregateEntries('opencode', entries, start, end)
    expect(result.daily.length).toBe(0)
  })
})
```

- [ ] **Step 5: 运行测试**

Run: `npm test`
Expected: 所有测试通过

- [ ] **Step 6: Commit**

```bash
git add package.json src/test/
git commit -m "test: add vitest unit tests for utils and aggregator"
```
