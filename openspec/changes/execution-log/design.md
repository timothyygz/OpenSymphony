## Context

当前 Orchestrator 使用 Pino logger 将所有日志输出到 stdout/stderr，没有文件持久化。`.symphony-tokens.jsonl` 是唯一的持久化文件，但它只在 worker 退出时记录一条 token 汇总，不包含调度过程中的事件细节（dispatch、turn 执行、stall、retry 等）。

当任务静默失败（如 SYMP-008 turns=0）时，无法事后排查原因。

现有的 `TokenLog` 类（`src/metrics/token-log.ts`）已提供了 JSONL append-only 的模式，可以作为参考。

## Goals / Non-Goals

**Goals:**
- 记录 Orchestrator 全生命周期的结构化事件到 JSONL 文件
- 每条记录包含事件类型、时间戳、issue 标识、以及事件相关的上下文数据
- 与现有 `TokenLog` 模式一致：append-only JSONL、基于 WORKFLOW.md 路径推导文件位置
- 支持按 issue identifier 查询历史执行记录
- 最小化对现有代码的侵入：通过依赖注入传入 `ExecutionLog`，类似 `TokenLog`

**Non-Goals:**
- 不做日志轮转（rotation）或自动清理——JSONL 文件增长由运维处理
- 不做日志搜索 UI——CLI 查询即可
- 不替代 Pino console 日志——两者并存，console 用于实时观察，文件用于事后排查
- 不记录 Agent 的 streaming 事件内容——只记录调度层面的元事件

## Decisions

### 1. 独立的 `ExecutionLog` 类 vs 扩展 Pino

**选择**：独立的 `ExecutionLog` 类，JSONL 格式。

**理由**：Pino 是通用 logger，适合 console 输出。执行日志是结构化的事件流，查询模式不同（按 identifier 过滤）。JSONL 格式与现有 `TokenLog` 一致，且每条记录自包含，append 操作原子性好。

### 2. 事件类型设计

采用枚举化的字符串事件类型，每条记录包含公共字段 + 事件特定字段：

```typescript
type ExecutionEvent =
  | { event: "dispatch"; attempt: number }  // 首次 dispatch 时 attempt=0（从 null 规范化）
  | { event: "worker_spawn_failed"; error: string }
  | { event: "session_started"; sessionId: string }
  | { event: "turn_completed"; turn: number; inputTokens: number; outputTokens: number }
  | { event: "turn_failed"; turn: number; error: string }
  | { event: "worker_exit"; reason: "normal" | "failed" | "stall" | "external_cancel"; turns: number; totalTokens: number }
  | { event: "tracker_state_updated"; fromState: string; toState: string }
  | { event: "stall_detected"; elapsed: number; timeout: number }
  | { event: "retry_scheduled"; attempt: number; backoffMs: number; reason: string }
```

公共字段：`timestamp`, `issueId`, `identifier`

### 3. 日志文件路径

与 `.symphony-tokens.jsonl` 同目录，文件名 `.symphony-execution.jsonl`。在 `cli.ts` 中构造路径，注入到 `OrchestratorDeps`。

### 4. 写入时机

同步 `appendFileSync`，与 `TokenLog` 一致。避免异步写入在进程崩溃时丢失最后几条日志。

### 5. CLI 查询

扩展 `scripts/bitable-task.ts` 的 `show` 命令：当存在 `.symphony-execution.jsonl` 时，自动显示该 issue 的执行事件时间线。同一 identifier 的多轮 dispatch（首次 + retry）按 attempt 分组展示，每组之间加分隔线，便于区分不同 run。

## Risks / Trade-offs

- **[文件增长]** → 单个任务约 10-30 条事件，每条约 200-500 字节。1000 个任务约 5-15MB，可接受。不做自动轮转。
- **[同步写入性能]** → `appendFileSync` 在每次事件时调用。调度频率低（每 30s 一轮 tick），写入量极小，不影响性能。
- **[磁盘故障]** → 日志写入失败时 fallback 到 Pino warn，不阻塞调度主流程。
- **[多实例并发写入]** → 单实例部署无并发问题。多实例共享同一 `.symphony-execution.jsonl` 时，依赖 OS 的 append 原子性（POSIX 下小于 PIPE_BUF 的写入是原子的）。单行超过 PIPE_BUF（通常 512-4096 字节）的极端情况可能出现行交错。多实例场景建议每个实例使用独立日志文件。
