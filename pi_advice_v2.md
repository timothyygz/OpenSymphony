# Symphony 代码审查 — 逻辑问题清单

> 对 src/ 全部源代码和 tests/ 测试代码逐文件审查，发现的逻辑问题。
> 审查日期：2026-05-02

---

## 🔴 严重 Bug（会导致运行时错误或数据错误）

### 1. `createForIssue` 是同步函数但内部调用了 async hook —— workspace 清理时机错误

**文件**: `src/workspace/manager.ts` — `createForIssue` 方法

```typescript
createForIssue(identifier: string): Workspace {   // ← 同步函数
  // ...
  if (createdNow) {
    runHookIfConfigured("after_create", ...)       // ← 返回 Promise
      .catch((err) => {
        try { rmSync(workspacePath, ...); }        // ← catch 里同步删除
        throw new WorkspaceCreationError(...);     // ← throw 在 .catch 回调里，不会被调用者捕获
      });
  }
  return workspace;  // ← 立即返回，不等 hook 完成
}
```

**问题**：
1. `createForIssue` 是**同步**的，但 `after_create` hook 是异步的。函数在 hook 执行完之前就返回了 workspace，后续代码（`before_run`、agent 启动）可能在一个尚未完成 `after_create` 的 workspace 上操作。
2. hook 失败时，`throw` 在 `.catch()` 回调里，**不会被 `createForIssue` 的调用者捕获**。调用者拿到的是一个"成功"创建的 workspace（实际上可能已被 `rmSync` 删除）。
3. Orchestrator 的 `runWorker` 没有对 `createForIssue` 做 `await`（因为它不是 async），所以即便改成 async，调用方也需要配合。

**修复建议**：把 `createForIssue` 改为 `async`，`await` hook 结果。同步调用方（如 Orchestrator 的 `runWorker`）也需要相应改为 `await`。

---

### 2. `reconcileStalled` 删除 running entry 时，worker 仍在后台运行 —— 同一 issue 被重试两次

**文件**: `src/orchestrator/orchestrator.ts` — `reconcileStalled` 方法

```typescript
this.state.running.delete(issueId);    // ← 从 running map 中删除
addRuntimeSeconds(this.state, entry);
this.state.claimed.delete(issueId);    // ← 释放 claim
scheduleRetry(...);                    // ← 立即安排重试
```

但与此同时，`runWorker` 的 Promise 仍在后台运行（Claude Code 进程还在跑）。当 worker 最终完成时，`onWorkerExit` 会再次尝试 `state.running.delete(issueId)`（此时已经不存在了，所以跳过），但 `scheduleRetry` 会再创建一个新的重试——导致**同一个 issue 被重试两次**。

**修复建议**：stall 检测应该设置一个标志位（如 `entry.stalled = true`），在 `onWorkerExit` 中检查该标志位，如果已经 stall 处理过就不再 scheduleRetry。或者给 `RunningEntry` 增加 `cancelled: boolean` 字段，stall/reconcilation 终止时设为 true，worker 退出时检查。

---

### 3. `reconcileTrackerStates` 终止 worker 不杀进程 —— 孤儿进程

**文件**: `src/orchestrator/orchestrator.ts` — `reconcileTrackerStates` 方法

和 stall detection 相同的问题：当 reconciliation 发现 issue 变为终止态时，它直接从 `running` map 中删除 entry 并释放 claim。但后台 worker 还在跑。当 worker 退出时 `onWorkerExit` 找不到 entry（返回 early），虽然不会 scheduleRetry，但 worker 的 `agent.stopSession()` 不会被调用，**Claude Code 子进程可能变成孤儿进程**。

**修复建议**：
- 给 `RunningEntry` 加 `abortController: AbortController` 字段
- reconciliation 终止时调用 `entry.abortController.abort()`
- `runWorker` 内部检查 abort signal，在 turn loop 的每次迭代开始前检查是否被取消
- 取消时调用 `agent.stopSession()` 并清理进程

---

### 4. `dispatchIssue` 发起 `runWorker` 不 await —— 同步异常的竞态窗口

**文件**: `src/orchestrator/orchestrator.ts` — `dispatchIssue` → `runWorker`

```typescript
private dispatchIssue(issue: Issue, attempt: number | null): void {
  // ...
  this.state.running.set(issue.id, entry);      // ← 先加入 running
  this.state.claimed.add(issue.id);

  this.runWorker(issue, attempt, sessionId).catch((err) => {
    // ← 异步 .catch，在下一个 microtask 执行
    this.state.running.delete(issue.id);
    scheduleRetry(...);
  });
}
```

如果 `runWorker` **同步抛出**（比如 `createForIssue` 抛出 `WorkspaceSafetyError`），由于 `dispatchIssue` 没有用 `await`，这个错误会在下一个 microtask 中被 `.catch` 捕获。但此时 `state.running` 已经被设置了。在 `.catch` 回调执行之前的这个 microtask 窗口里，下一个 tick 可能已经开始了，并看到了一个 "ghost" running entry。

**修复建议**：将 `runWorker` 调用改为 `await this.runWorker(...)` 或者在 `dispatchIssue` 内用 try/catch 包裹同步部分，确保同步异常时立即清理 state。

---

## 🟡 中等问题（可能导致意外行为）

### 5. `prompt.ts` 中 `renderTemplate` 先 `parse` 再 `parseAndRenderSync` —— 错误分类无效

**文件**: `src/workflow/prompt.ts`

```typescript
export function renderTemplate(...) {
  try {
    engine.parse(template);              // ← 第一次解析（仅验证）
  } catch (err) {
    throw new TemplateParseError(...);   // ← 模板语法错误
  }
  try {
    return engine.parseAndRenderSync(...); // ← 第二次解析 + 渲染
  } catch (err) {
    throw new TemplateRenderError(...);    // ← 这里也会捕获 parse 错误
  }
}
```

`parseAndRenderSync` 内部也会 parse，如果 parse 失败会抛出 Liquid 的错误，被外层 catch 转为 `TemplateRenderError` 而不是 `TemplateParseError`。两次 parse 的区分是无效的——真正的 parse 错误可能被归入 render 错误。

**修复建议**：只用 `parseAndRenderSync`，在 catch 中根据 Liquid 错误类型区分是 parse 还是 render 错误。或者第一次 parse 用 `engine.parse(template)` 缓存结果，然后用 `engine.renderSync(cached, data)` 渲染。

---

### 6. `fetchIssueStatesByIds` 使用 `record_id` 做 filter 字段 —— 飞书 API 不支持

**文件**: `src/adapters/tracker/feishu-bitable/api.ts` — `getRecordsByIds`

```typescript
const filter = {
  conjunction: "or",
  conditions: recordIds.map((id) => ({
    field_name: "record_id",     // ← 这不是飞书多维表格的合法字段名
    operator: "is",
    value: [id],
  })),
};
```

飞书多维表格的 `record_id` 不是一个可以用 filter 条件查询的字段。要用 record_id 批量获取记录，应该使用 `GET /open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/records/{record_id}` 逐个获取，或者使用 search API。

**影响**：`fetchIssueStatesByIds` 在实际调用时可能返回空结果，导致：
- Orchestrator reconciliation 认为所有 running issue 都不在 candidates 中
- Worker turn loop 中的 issue 状态刷新失败（走 catch 分支，worker 退出）

**修复建议**：改为逐个调用 `GET .../records/{record_id}`，或使用 batch get 如果飞书有提供。

---

### 7. `cli.ts` 和 `watcher.ts` 中 workflowDir 的提取方式不健壮

**文件**: `src/cli.ts` 和 `src/workflow/watcher.ts`

```typescript
const workflowDir = resolvedPath.substring(0, resolvedPath.lastIndexOf("/"));
```

**问题**：
- 如果路径没有 `/`（如单独文件名 `WORKFLOW.md`），`lastIndexOf("/")` 返回 -1，`substring(0, -1)` 返回空字符串
- Windows 路径使用 `\` 分隔

**修复建议**：使用 `import { dirname } from "node:path"; const workflowDir = dirname(resolvedPath);`

---

### 8. Hook 超时后只发 SIGTERM，没有后续 SIGKILL 降级

**文件**: `src/workspace/hooks.ts`

```typescript
const timeoutHandle = setTimeout(() => {
  try { proc.kill("SIGTERM"); } catch {}
}, timeoutMs);
```

如果 hook 进程忽略 SIGTERM（比如正在执行一个长时间运行的 shell 命令），进程不会退出。应该加一个 SIGKILL 的二级超时。

**修复建议**：

```typescript
const timeoutHandle = setTimeout(() => {
  try { proc.kill("SIGTERM"); } catch {}
  // 5s 后强制 kill
  setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} }, 5000);
}, timeoutMs);
```

---

### 9. `validateDispatchConfig` 校验的是 `codex.command` 而非 `claude_code.command`

**文件**: `src/workflow/config.ts`

```typescript
export function validateDispatchConfig(config: ServiceConfig): string | null {
  // ...
  const agentCommand = config.codex.command;   // ← 检查 codex.command
  if (!agentCommand) return "codex.command is required";
  return null;
}
```

但 `cli.ts` 中实际创建 agent 时用的是：

```typescript
const agentConfig = config.claude_code ?? { command: config.codex.command };
```

当 `tracker.kind = "feishu_bitable"` 时，`codex.command` 的默认值是 `"codex app-server"`，这个校验永远通过，但不代表 Claude Code CLI 真的可用。同时，如果用户只配了 `claude_code` 没配 `codex`，校验信息说 "codex.command is required" 会造成困惑。

**修复建议**：根据 tracker kind 或 agent adapter kind 来校验对应的 command 字段。

---

### 10. `runClaudeProcess` 超时 kill 后没有 drain stderr —— 可能僵尸进程

**文件**: `src/adapters/agent/claude-code/process.ts`

超时后只 kill 了进程，但 stderr pipe 可能还有数据没读。这可能导致 pipe 缓冲区满而进程不退出（SIGTERM 后进程卡在 write to full pipe buffer）。

**修复建议**：超时后先 drain stderr 或直接关闭 pipe，再 kill。

---

## 🟢 小问题

### 11. 测试框架不匹配 —— `package.json` 用 `bun test`，测试文件用 vitest

**文件**: `package.json`

```json
"scripts": {
  "test": "bun test",    // ← Bun 内置 test runner
}
```

但所有测试文件都是：

```typescript
import { describe, it, expect } from "vitest";   // ← vitest API
```

Bun 的内置 test runner 不认识 vitest 的 import。运行 `bun test` 会直接报错。

**修复建议**：
- 方案 A：改用 `"test": "bunx vitest run"`
- 方案 B：将测试文件改为 `import { describe, it, expect } from "bun:test"`

---

## 总结

| 严重度 | # | 问题 | 关键文件 |
|--------|---|------|----------|
| 🔴 | 1 | `createForIssue` 同步/异步不一致，hook 失败不被捕获 | workspace/manager.ts |
| 🔴 | 2 | stall 检测导致同一 issue 被重试两次 | orchestrator/orchestrator.ts |
| 🔴 | 3 | reconciliation 终止 worker 不杀进程，孤儿进程 | orchestrator/orchestrator.ts |
| 🔴 | 4 | worker 同步异常与 tick 的竞态窗口 | orchestrator/orchestrator.ts |
| 🟡 | 5 | 模板 parse/render 错误分类无效 | workflow/prompt.ts |
| 🟡 | 6 | `record_id` filter 在飞书 API 中不工作 | feishu-bitable/api.ts |
| 🟡 | 7 | workflowDir 用 `lastIndexOf("/")` 而非 `path.dirname` | cli.ts, watcher.ts |
| 🟡 | 8 | Hook 超时无 SIGKILL 降级 | workspace/hooks.ts |
| 🟡 | 9 | dispatch 校验检查 codex.command 而非 claude_code.command | workflow/config.ts |
| 🟡 | 10 | 超时 kill 后不 drain stderr | claude-code/process.ts |
| 🟢 | 11 | 测试框架不匹配（bun test vs vitest） | package.json |
