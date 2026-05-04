# OpenSymphony 执行生命周期

本文档描述 OpenSymphony 从启动到关闭的完整执行流程。

## 概览

OpenSymphony 是一个编码智能体编排服务，基于 [OpenAI Symphony SPEC](https://github.com/openai/symphony/blob/main/SPEC.md)。它从飞书多维表格轮询待处理任务，将每个任务分派给独立的 Claude Code 会话执行，并管理完整的生命周期——重试、状态流转、Token 追踪、工作区清理和 TUI 仪表盘。

```
┌─────────┐    ┌────────────┐    ┌───────────┐    ┌──────────────┐    ┌──────────┐
│  CLI    │───▶│  启动初始化  │───▶│  编排器    │───▶│  Worker 执行  │───▶│  退出处理  │
│ 入口    │    │  配置加载    │    │  Tick 循环  │    │  Turn 循环    │    │  重试/完成  │
└─────────┘    └────────────┘    └───────────┘    └──────────────┘    └──────────┘
```

---

## 阶段一：CLI 启动

**入口文件：** `src/cli.ts`

```bash
bun run start                   # 使用默认 WORKFLOW.md
bun run start ./my-flow.md      # 指定工作流文件
bun run start --no-tui          # 无头模式（JSON 日志输出到 stdout）
```

执行步骤：

1. **解析 CLI 参数** — 可选的 WORKFLOW.md 路径 + `--no-tui` 标志
2. **决定运行模式** — 检测 TTY + `--no-tui` 标志。TUI 模式下日志重定向到 stderr
3. **动态加载核心模块** — 懒加载所有依赖
4. **注册内置适配器** — `feishu_bitable` tracker + `claude-code` agent
5. **解析 WORKFLOW.md 路径** — 支持相对路径、绝对路径
6. **加载并解析工作流** — YAML front matter + Liquid 模板体 → `WorkflowDefinition`
7. **构建并校验配置** — Zod schema 验证，解析 `$ENV` 环境变量，路径展开
8. **校验分发配置** — 确保必要字段齐全
9. **创建适配器实例** — tracker（飞书多维表格）+ agent（Claude Code）
10. **创建 WorkspaceManager** — 管理 agent 工作区目录
11. **创建日志和指标收集器** — `TokenLog` + `ExecutionLog`
12. **创建 Orchestrator** — 核心编排器
13. **创建 TUI Dashboard**（如启用）
14. **启动 WorkflowWatcher** — 监听 WORKFLOW.md 变更热重载
15. **注册优雅关停信号** — SIGINT / SIGTERM
16. **启动 Orchestrator**

**关键文件：**

| 文件 | 职责 |
|------|------|
| `src/cli.ts` | 入口，串联所有组件 |
| `src/workflow/loader.ts` | 解析 WORKFLOW.md |
| `src/workflow/config.ts` | Zod 校验，构建 `ServiceConfig` |
| `src/adapters/tracker/registry.ts` | tracker 适配器注册/创建 |
| `src/adapters/agent/registry.ts` | agent 适配器注册/创建 |

---

## 阶段二：启动清理

在编排器首次 tick 之前执行，清理上次运行遗留的终态工作区。

1. 从 tracker 获取所有处于**终态**（如"已完成"、"已取消"）的 issue
2. 批量清理这些 issue 对应的工作区目录
3. 防止磁盘空间被已完成任务的旧工作区占满

**关键文件：** `src/orchestrator/orchestrator.ts` — `startupCleanup()`

---

## 阶段三：Tick 循环（核心调度）

Orchestrator 启动后进入周期性 tick 循环，默认每 30 秒一次（首次立即执行）。

```
┌──────────────────────────────────────────────────┐
│                  Tick 循环                        │
│                                                  │
│  1. 对账停滞 Worker (reconcileStalled)            │
│  2. 对账 Tracker 状态 (reconcileTrackerStates)    │
│  3. 校验分发配置                                   │
│  4. 获取候选 Issue (fetchCandidateIssues)         │
│  5. 排序 (sortForDispatch)                        │
│  6. 分发 (canDispatch → dispatchIssue)            │
│                                                  │
│  ─── 等待 pollIntervalMs ─── 循环 ───             │
└──────────────────────────────────────────────────┘
```

### 3.1 对账停滞 Worker

遍历所有正在运行的条目，检查是否超过 `stall_timeout_ms` 无活动：
- 超时 → 终止 worker，释放槽位，调度指数退避重试
- `stall_timeout_ms <= 0` → 禁用此检查

### 3.2 对账 Tracker 状态

从 tracker 刷新所有运行中 issue 的最新状态：
- **终态** → 终止 worker，清理工作区
- **活跃态** → 更新内存中的 issue 快照
- **其他** → 停止 worker 但不清理

### 3.3 获取与排序候选 Issue

- 从 tracker 获取所有活跃状态的 issue
- 按优先级（升序）→ 创建时间（升序）→ 标识符 排序

### 3.4 分发决策（canDispatch）

对每个排序后的 issue 依次检查：

| 条件 | 说明 |
|------|------|
| 必填字段完整 | issue 包含 tracker 要求的所有字段 |
| 活跃状态 | issue 处于 `active_states` 之一 |
| 未在运行/已声明 | 不在 running map 或 claimed set 中 |
| 全局并发未满 | 当前运行数 < `max_concurrent_agents` |
| 按状态并发未满 | 该状态的运行数 < `max_concurrent_agents_by_state` |

**关键文件：**

| 文件 | 职责 |
|------|------|
| `src/orchestrator/orchestrator.ts` | tick 主循环 |
| `src/orchestrator/state.ts` | 运行时状态管理 |
| `src/orchestrator/dispatch.ts` | 排序与分发决策 |

---

## 阶段四：分发 Issue

通过所有检查后，执行分发：

```
tracker 状态: 待处理 ──▶ 进行中（分布式锁）
                           │
                           ▼
              ┌─── 记录 RunningEntry ───┐
              │   写入 Join Command      │
              │   记录 ExecutionLog      │
              └─────────────────────────┘
                           │
                           ▼
              ┌─── 后台启动 runWorker ────┐
              │   (异步，fire-and-forget)   │
              └───────────────────────────┘
```

1. 创建 `RunningEntry` 加入 running map + claimed set
2. **分布式锁**：立即将 tracker 中 issue 状态更新为 `in_progress_state`，防止其他实例重复分发
3. 写入初始 join command（供人类观察/交互）
4. 记录 `dispatch` 事件到 ExecutionLog
5. 后台异步启动 `runWorker()`

---

## 阶段五：Worker 执行

每个被分发的 issue 由一个独立的 Worker 处理。

### 5.1 工作区准备

```
{workspace.root}/{issue.identifier}/
```

1. **创建/复用工作区** — 在配置的根目录下为 issue 创建独立目录
2. **初始化 Git Sources** — 按 `workspace.sources` 配置执行 `git clone` 或 `git worktree`
3. **执行 `after_create` Hook** — 工作区创建后的初始化脚本

### 5.2 执行前 Hook

运行 `before_run` 配置的 shell 脚本（如安装依赖、环境准备）。

### 5.3 Agent 会话初始化

1. 创建 Claude Code 会话（元数据级，实际进程在 Turn 中启动）
2. 初始化 Turn 日志 `{workspace}/.symphony/turns.jsonl` 和 `meta.json`

### 5.4 Turn 循环

```
┌─────────────────────────────────────────┐
│            Turn 循环 (max_turns 次)      │
│                                         │
│  ┌─ 构建 Prompt ──────────────────────┐ │
│  │  Turn 1: Liquid 模板渲染            │ │
│  │  Turn 2+: 续接引导 (continuation)   │ │
│  └─────────────────────────────────────┘ │
│                │                         │
│                ▼                         │
│  ┌─ 执行 Agent Turn ──────────────────┐ │
│  │  claude -p <prompt>                 │ │
│  │       --output-format stream-json   │ │
│  │       --verbose                     │ │
│  │  或 claude --resume <sessionId>     │ │
│  └─────────────────────────────────────┘ │
│                │                         │
│                ▼                         │
│  ┌─ 处理流式事件 ─────────────────────┐ │
│  │  • 捕获 sessionId                  │ │
│  │  • 记录 tool calls                 │ │
│  │  • 累加 token 用量 (delta)         │ │
│  │  • 更新 rate limits                │ │
│  └─────────────────────────────────────┘ │
│                │                         │
│                ▼                         │
│  ┌─ 更新进度 & 状态检查 ──────────────┐ │
│  │  • 写入 tracker 进度               │ │
│  │  • 刷新 issue 状态                 │ │
│  │  • 如果不再活跃 → break            │ │
│  └─────────────────────────────────────┘│
│                                         │
└─────────────────────────────────────────┘
```

**Prompt 构建策略：**
- **首轮**：使用 WORKFLOW.md 中的 Liquid 模板，渲染 issue 上下文（标题、描述、标签等）
- **后续轮次**：使用 `buildContinuationGuidance()` 生成简短的续接提示

**Claude Code 进程模式：**
- 首次 turn：`claude -p <prompt> --output-format stream-json --verbose`
- 后续 turn：`claude --resume <sessionId> -p <prompt> --output-format stream-json --verbose`

**事件处理（onAgentEvent）：**

| 事件 | 处理 |
|------|------|
| `sessionId` 捕获 | 首次获取后更新 join command 和 meta.json |
| `assistant` / `message` | 写入 turn log |
| `tool_use` | 记录工具名称和输入到 turn log |
| `tool_result` | 记录工具输出到 turn log |
| `usage` | Delta 累加 token 用量（避免重复计数） |
| `rateLimits` | 更新全局速率限制状态 |

### 5.5 执行后 Hook

最佳努力执行 `after_run` 配置的 shell 脚本。

**关键文件：**

| 文件 | 职责 |
|------|------|
| `src/orchestrator/orchestrator.ts` | runWorker(), onAgentEvent() |
| `src/workflow/prompt.ts` | Liquid 模板渲染 + 续接引导 |
| `src/adapters/agent/claude-code/` | Claude Code 进程管理 + 流式解析 |
| `src/workspace/manager.ts` | 工作区创建/清理 |
| `src/workspace/hooks.ts` | Hook 执行 |
| `src/workspace/sources.ts` | Git source 初始化 |
| `src/logging/turn-log.ts` | Turn 级别日志 |

---

## 阶段六：Worker 退出处理

Worker 执行完毕后进入退出处理流程：

```
                    ┌── Worker 退出 ──┐
                    │                 │
            ┌───────┴───────┐  ┌─────┴──────┐
            │   正常退出     │  │   异常退出   │
            └───────┬───────┘  └─────┬──────┘
                    │                │
                    ▼                ▼
        ┌── 写入结果摘要 ──┐  ┌── 重置为活跃态 ──┐
        │  更新到 tracker  │  │  (active_reset)   │
        └────────┬────────┘  └────────┬──────────┘
                 │                    │
                 ▼                    ▼
        ┌── 标记为终态 ─────┐  ┌── 调度重试 ──────┐
        │  "已完成" 等      │  │  指数退避定时器    │
        └────────┬─────────┘  └────────┬──────────┘
                 │                     │
                 ▼                     ▼
        加入 completed set        加入 retry map
```

### 正常退出（reason: "normal"）

1. 写入最后一条 agent 消息作为结果摘要（截断至 1000 字符）
2. 在 tracker 中将 issue 状态更新为终态（如"已完成"）
3. 加入 `completed` 集合

### 异常退出（reason: "failed"）

1. 在 tracker 中将 issue 状态重置为 `active_reset_state`（如"待处理"）
2. 调度指数退避重试

**关键文件：** `src/orchestrator/orchestrator.ts` — `onWorkerExit()`

---

## 阶段七：重试机制

```
重试延迟 = min(10s × 2^(attempt-1), max_retry_backoff_ms)
```

| 参数 | 默认值 | 说明 |
|------|--------|------|
| 首次重试延迟 | 10s | `10s × 2^0` |
| 最大重试延迟 | 5 min | `max_retry_backoff_ms` |
| 退避策略 | 指数退避 | 每次 attempt 翻倍 |

### 重试触发条件

| 场景 | 触发 |
|------|------|
| Worker 异常退出 | `onWorkerExit` 中调度 |
| 停滞检测 | `reconcileStalled` 中调度 |
| Worker 启动失败 | `dispatchIssue` 的 catch 中调度 |
| 重试轮询失败 | `onRetryTimer` 中重新调度 |
| 无可用槽位 | `onRetryTimer` 中重新调度 |

### 重试执行流程（onRetryTimer）

1. 从 retry map 取出重试信息
2. 重新获取候选 issue 列表
3. 检查 issue 是否仍在候选列表中（可能已被外部取消）
4. 检查是否有可用槽位
5. 条件满足 → `dispatchIssue(issue, attempt)`
6. 条件不满足 → 重新调度下一次重试

**关键文件：** `src/orchestrator/retry.ts`

---

## 阶段八：热重载

WorkflowWatcher 监听 WORKFLOW.md 文件变更，支持运行时热重载。

- **轮询间隔**：1 秒
- **去抖动**：300ms
- **重载流程**：
  1. 检测文件变更
  2. 重新解析 WORKFLOW.md
  3. 校验新配置（Zod schema）
  4. 合法 → 调用 `orchestrator.updateConfig()` 更新轮询间隔、并发限制等
  5. 非法 → 记录错误，保留上次有效配置

**关键文件：** `src/workflow/watcher.ts`

---

## 阶段九：优雅关停

SIGINT / SIGTERM 触发：

1. 停止 TUI Dashboard
2. 停止 WorkflowWatcher
3. 停止 Orchestrator（取消 tick 定时器）
4. 退出进程

> 注意：正在运行的 Worker（Claude Code 子进程）不会被强制终止，它们会自然完成。

---

## 运行时产物

执行过程中产生的文件：

| 文件 | 位置 | 说明 |
|------|------|------|
| `.symphony-execution.jsonl` | 项目根目录 | 所有生命周期事件的结构化 JSONL 日志 |
| `.symphony-tokens.jsonl` | 项目根目录 | 每个 issue 的 token 用量记录 |
| `{workspace}/.symphony/meta.json` | 工作区目录 | 会话元数据（issue ID、session ID、join command、turn 数、token 数） |
| `{workspace}/.symphony/turns.jsonl` | 工作区目录 | 逐 turn 的 prompt、消息、工具调用和工具结果日志 |

### ExecutionLog 事件类型

| 事件 | 触发时机 |
|------|----------|
| `dispatch` | issue 被分发时 |
| `session_started` | agent 会话创建时 |
| `turn_completed` | 单个 turn 成功完成时 |
| `turn_failed` | 单个 turn 执行失败时 |
| `worker_exit` | worker 退出时（包含 reason: normal/failed/stall/external_cancel） |
| `stall_detected` | 检测到停滞 worker 时 |
| `retry_scheduled` | 重试被调度时 |
| `worker_spawn_failed` | worker 启动失败时 |
| `tracker_state_updated` | tracker 状态被更新时 |

---

## 组件关系总览

```
cli.ts
  │
  ├── WorkflowLoader ─── 解析 WORKFLOW.md (YAML + Liquid)
  ├── WorkflowWatcher ── 文件监听热重载
  ├── ConfigBuilder ──── Zod 校验 + 环境变量解析
  ├── PromptRenderer ─── LiquidJS 模板引擎
  │
  └── Orchestrator ────── 核心编排器
        ├── State ─────── 运行时状态 (running map, claimed set, retry map)
        ├── Dispatch ──── 排序与分发决策
        └── Retry ─────── 指数退避重试定时器
  │
  ├── TrackerAdapter ─── 飞书多维表格适配器
  │     ├── 认证 (tenant_access_token)
  │     ├── API (list/search/update records)
  │     └── 映射 (BitableRecord → Issue)
  │
  ├── AgentAdapter ────── Claude Code 适配器
  │     ├── 进程管理 (Bun.spawn + timeout)
  │     └── 流式解析 (JSON line → AgentEvent)
  │
  ├── WorkspaceManager ── 工作区生命周期
  │     ├── Safety ──── 路径消毒与隔离校验
  │     ├── Hooks ───── Shell hook 执行器
  │     └── Sources ─── Git clone/worktree 初始化
  │
  ├── TokenLog ────────── Token 用量 JSONL 追踪
  ├── ExecutionLog ────── 生命周期事件 JSONL 追踪
  └── Dashboard ───────── TUI 实时仪表盘 (可选)
```

---

## 状态流转图

```
                    ┌──────────┐
                    │  待处理   │ ◀── active_reset_state
                    │ (pending)│
                    └────┬─────┘
                         │ dispatchIssue()
                         ▼
                    ┌──────────┐
                    │  进行中   │
                    │(in_progress)
                    └────┬─────┘
                         │
              ┌──────────┼──────────┐
              │          │          │
              ▼          ▼          ▼
        ┌──────────┐ ┌────────┐ ┌──────────┐
        │  已完成   │ │ 已取消  │ │ 失败→重试 │
        │(completed)│ │(canceled)│ │ 退避后    │
        └──────────┘ └────────┘ │ 回到待处理 │
                               └──────────┘
```
