# vscode-slopmeter 重构计划

## 概述

当前代码能跑但有明显的工程质量缺陷。本计划按优先级分 4 个阶段，从核心架构问题到细节打磨，每阶段可独立提交。

---

## 阶段一：消除重复代码（最重要）

### 1.1 提取公共聚合逻辑

**问题**：三个 Provider 的 `aggregateMessages`/`aggregateSessions` 方法有 ~80 行几乎一模一样的代码（构建 dailyMap → 排序 → 计算 streak → 找 mostUsedModel → 返回 UsageSummary）。

**方案**：新建 `src/providers/aggregator.ts`，提取统一的聚合引擎。

```typescript
// src/providers/aggregator.ts

/** Provider 只需把原始数据转成这个格式 */
export interface NormalizedEntry {
  timestamp: number        // 毫秒级时间戳
  inputTokens: number
  outputTokens: number
  cacheRead: number
  cacheWrite: number
  modelName: string
}

/** Provider 实现此接口即可，不需要自己写聚合 */
export interface IRawDataProvider {
  id: ProviderId
  name: string
  isAvailable(): boolean
  /** 加载原始数据并归一化，返回 NormalizedEntry 数组 */
  loadEntries(start: Date, end: Date): Promise<NormalizedEntry[]>
}

/** 统一聚合函数，所有 Provider 共用 */
export function aggregateEntries(
  providerId: ProviderId,
  entries: NormalizedEntry[],
  start: Date,
  end: Date
): UsageSummary {
  // dailyMap 构建、排序、streak、mostUsedModel 全部在这里
  // 从三个 Provider 中提取的公共逻辑，只写一次
}
```

**改动范围**：
- 新建 `src/providers/aggregator.ts`
- `opencode.ts`、`claude.ts`、`hermes.ts` 各自只保留数据加载和归一化逻辑，删除 `aggregateMessages`/`aggregateSessions`
- 各 Provider 实现 `IRawDataProvider`，`loadData` 内部调用 `aggregateEntries`

### 1.2 提取公共工具函数

**问题**：`walkDir` 在 opencode.ts 和 claude.ts 中重复；`showPythonNotice` + `pythonNoticeShown` 在 opencode.ts 和 hermes.ts 中重复。

**方案**：
- `walkDir` 移到 `src/utils.ts`，两个 Provider 共同 import
- `showPythonNotice` 移到 `src/platform/python.ts`，用模块级 flag 防止重复弹窗

---

## 阶段二：修复阻塞和性能问题

### 2.1 execSync → execFile（异步）

**问题**：`execSync` 最长阻塞 30 秒，会冻住 VS Code UI。

**方案**：改用 Node.js 的 `child_process.execFile`（异步版本），配合 Promise 封装。

```typescript
// src/platform/python.ts 中新增
import { execFile } from 'child_process'
import { promisify } from 'util'
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

**改动范围**：
- `src/platform/python.ts` — 新增 `runPythonScript`
- `opencode.ts` — `loadViaPython` 改为 async，用 `runPythonScript`
- `hermes.ts` — 同上

### 2.2 sql.js 回退补上日期过滤

**问题**：`opencode.ts:165` 的 sql.js 回退没有 WHERE 条件，加载全部历史数据。

**方案**：

```typescript
// 改前
db.exec("SELECT id, data FROM message ORDER BY time_created ASC")

// 改后
const startSec = Math.floor(start.getTime() / 1000)
const endSec = Math.floor(end.getTime() / 1000)
const stmt = db.prepare(
  "SELECT id, data FROM message WHERE time_created >= ? AND time_created <= ? ORDER BY time_created ASC"
)
stmt.bind([startSec, endSec])
```

同时把 `loadViaSqlJsFallback` 签名改为接收 `start`/`end` 参数。

### 2.3 Hermes 补 sql.js 回退

**问题**：Hermes 没有 sql.js 回退，Python 不可用时静默返回空。

**方案**：参照 OpenCode 的 sql.js 回退模式，给 Hermes 也加一个。逻辑一致，只是表名和字段不同。

---

## 阶段三：清理残留和未完成功能

### 3.1 清理残留依赖

- 删除根目录的 `better-sqlite3` 引用（如果 `package-lock.json` 中有残留，`npm install` 时重新生成 lock 文件）
- 确认 `node_modules/better-sqlite3` 不会被打包（`.vscodeignore` 已排除 node_modules，但 lock 文件干净更好）

### 3.2 修复 ESLint 配置

当前 `package.json` 有 `lint` 脚本但没装 ESLint。二选一：

**选项 A（推荐）**：删除 lint 脚本，暂不引入 ESLint
**选项 B**：安装 ESLint + TypeScript 插件，添加 `.eslintrc.json`

### 3.3 处理 export 命令

`extension.ts` 注册了 `slopMeter.export` 但实现是空的。两个选择：

**选项 A（推荐，低成本）**：暂时从 `package.json` 的 `commands` 中移除 export，避免用户点击后无响应
**选项 B**：实现 CSV/JSON 导出功能（工作量较大，可作为后续版本）

### 3.4 清理 models.ts 中未实现的 Provider

`models.ts` 的 `ProviderId` 包含 `codex | cursor | gemini | pi | amp`，但没有对应实现。`PROVIDER_META` 里有颜色配置但无实际 Provider。

**方案**：保留 `PROVIDER_META` 中的颜色定义（未来扩展用），但在 `ProviderId` 类型注释中标注哪些是"planned"。或者干脆把未实现的从 `ProviderId` 移到一个 `PlannedProviderId` 联合类型，避免误导。

### 3.5 删除未使用的 import

`opencode.ts` 和 `hermes.ts` import 了 `tryMtime` 但从未调用，删除该 import。

---

## 阶段四：补充测试和文档

### 4.1 添加单元测试

**框架**：VS Code 扩展标准用 `@vscode/test-electron`，但对于纯逻辑函数用普通 Jest/Mocha 即可。

**优先测试**（纯函数，无需 mock）：
- `src/utils.ts` — `formatDate`、`parseTimestamp`、`getHeatmapLevel`、`computeLongestStreak`、`computeCurrentStreak`、`formatTokenTotal`
- `src/providers/aggregator.ts` — `aggregateEntries`（阶段一提取后）

**次优先测试**（需要 mock 文件系统）：
- `src/platform/paths.ts` — `firstExisting`
- `src/cache/dataCache.ts` — 缓存命中/失效/淘汰逻辑

**方案**：
- 安装 `vitest`（轻量，无需复杂配置）或 `mocha` + `@types/mocha`
- 在 `package.json` 添加 `"test": "vitest run"` 脚本
- 创建 `src/test/` 目录

### 4.2 补充 JSDoc 注释

至少给以下内容加注释：
- `IProvider` 接口的每个方法
- `aggregateEntries` 函数（参数含义、返回值结构）
- `DataCache` 类的使用方式
- `parseTimestamp` 的兼容逻辑（秒/毫秒、数字/字符串）

### 4.3 webview 中的重复函数

`formatTokenTotal` 和 `getHeatmapLevel` 在 `src/utils.ts` 和 `webview-ui/index.html` 中各写了一遍。

**方案**：在构建时把 utils.ts 中的函数注入 webview，或者至少在两处加注释互相引用，标注"修改时同步更新"。

---

## 执行顺序建议

```
阶段一 → 阶段二 → 阶段三 → 阶段四
```

- **阶段一**是核心，消除了最大的技术债
- **阶段二**修阻塞，用户体验直接改善
- **阶段三**是清理工作，每个小项可以独立 commit
- **阶段四**是长期维护的基础，可以逐步补充

每个阶段完成后建议跑一次 `npm run compile` 确认无编译错误，手动测试热力图显示正常。

---

## 文件变更清单

| 操作 | 文件 | 说明 |
|------|------|------|
| 新建 | `src/providers/aggregator.ts` | 统一聚合引擎 |
| 修改 | `src/providers/opencode.ts` | 删除聚合逻辑，实现 IRawDataProvider |
| 修改 | `src/providers/claude.ts` | 同上 |
| 修改 | `src/providers/hermes.ts` | 同上，补 sql.js 回退 |
| 修改 | `src/platform/python.ts` | 新增 runPythonScript，移入 showPythonNotice |
| 修改 | `src/utils.ts` | 移入 walkDir |
| 修改 | `src/platform/paths.ts` | 删除未使用的 tryMtime export（如果确认无其他调用方） |
| 修改 | `package.json` | 清理 scripts、补 test 脚本 |
| 修改 | `src/models.ts` | 清理未实现的 ProviderId |
| 新建 | `src/test/utils.test.ts` | utils 单元测试 |
| 新建 | `src/test/aggregator.test.ts` | 聚合逻辑单元测试 |
| 可选删除 | `webview-ui/index.html` 中重复的 utils 函数 | 改为构建注入或加同步注释 |
