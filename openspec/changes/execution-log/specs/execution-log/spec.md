## ADDED Requirements

### Requirement: ExecutionLog writes structured events to JSONL file
系统 SHALL 将 Orchestrator 调度生命周期中的关键事件以 JSONL 格式持久化到 `.symphony-execution.jsonl` 文件。每条记录 SHALL 包含公共字段：`timestamp`（ISO 8601）、`issueId`、`identifier`、`event`（事件类型字符串），以及事件类型的特定字段。

#### Scenario: Dispatch event is recorded
- **WHEN** Orchestrator dispatches an issue to a worker
- **THEN** 一条 `{ event: "dispatch", timestamp, issueId, identifier, attempt }` 记录 SHALL 被追加到执行日志文件，其中首次 dispatch 时 `attempt` 为 0

#### Scenario: Worker spawn failure is recorded
- **WHEN** worker 进程启动失败
- **THEN** 一条 `{ event: "worker_spawn_failed", timestamp, issueId, identifier, error }` 记录 SHALL 被追加到执行日志文件

#### Scenario: Session started event is recorded
- **WHEN** agent session 成功启动
- **THEN** 一条 `{ event: "session_started", timestamp, issueId, identifier, sessionId }` 记录 SHALL 被追加到执行日志文件

#### Scenario: Turn completed event is recorded
- **WHEN** 一个 turn 成功完成
- **THEN** 一条 `{ event: "turn_completed", timestamp, issueId, identifier, turn, inputTokens, outputTokens }` 记录 SHALL 被追加到执行日志文件

#### Scenario: Turn failed event is recorded
- **WHEN** 一个 turn 执行失败
- **THEN** 一条 `{ event: "turn_failed", timestamp, issueId, identifier, turn, error }` 记录 SHALL 被追加到执行日志文件

#### Scenario: Worker exit event is recorded
- **WHEN** worker 正常退出或异常退出
- **THEN** 一条 `{ event: "worker_exit", timestamp, issueId, identifier, reason, turns, totalTokens }` 记录 SHALL 被追加到执行日志文件，其中 `reason` 为 "normal"、"failed"、"stall" 或 "external_cancel"

#### Scenario: Worker exit on stall detection
- **WHEN** `reconcileStalled()` 检测到 worker 超时并终止
- **THEN** 在 `stall_detected` 事件之后 SHALL 追加一条 `{ event: "worker_exit", reason: "stall", ... }` 记录

#### Scenario: Worker exit on tracker terminal state
- **WHEN** `reconcileTrackerStates()` 发现 issue 处于 terminal state
- **THEN** 一条 `{ event: "worker_exit", reason: "normal", ... }` 记录 SHALL 被追加

#### Scenario: Worker exit on tracker non-active state
- **WHEN** `reconcileTrackerStates()` 发现 issue 处于 non-active、non-terminal state（如外部手动取消）
- **THEN** 一条 `{ event: "worker_exit", reason: "external_cancel", ... }` 记录 SHALL 被追加

#### Scenario: Stall detected event is recorded
- **WHEN** Orchestrator 检测到 worker 超过 stall timeout
- **THEN** 一条 `{ event: "stall_detected", timestamp, issueId, identifier, elapsed, timeout }` 记录 SHALL 被追加到执行日志文件

#### Scenario: Retry scheduled event is recorded
- **WHEN** Orchestrator 调度一次 retry
- **THEN** 一条 `{ event: "retry_scheduled", timestamp, issueId, identifier, attempt, backoffMs, reason }` 记录 SHALL 被追加到执行日志文件

#### Scenario: Tracker state updated event is recorded
- **WHEN** issue 的 tracker 状态被 Orchestrator 更新
- **THEN** 一条 `{ event: "tracker_state_updated", timestamp, issueId, identifier, fromState, toState }` 记录 SHALL 被追加到执行日志文件

### Requirement: ExecutionLog file path derivation
执行日志文件路径 SHALL 与 `.symphony-tokens.jsonl` 基于同一目录推导，文件名为 `.symphony-execution.jsonl`。

#### Scenario: Path derived from WORKFLOW.md location
- **WHEN** WORKFLOW.md 位于 `/project/WORKFLOW.md`
- **THEN** 执行日志文件路径 SHALL 为 `/project/.symphony-execution.jsonl`

### Requirement: ExecutionLog write failure tolerance
执行日志写入失败时 SHALL NOT 阻塞或影响调度主流程。

#### Scenario: File write fails gracefully
- **WHEN** `appendFileSync` 抛出异常（如磁盘满、权限不足）
- **THEN** 系统 SHALL 通过 Pino logger 记录一条 warn 级别日志，并继续正常调度

### Requirement: CLI show command displays execution history
`scripts/bitable-task.ts` 的 `show` 命令 SHALL 显示该 issue 在 `.symphony-execution.jsonl` 中的执行事件时间线。

#### Scenario: Show command with execution history
- **WHEN** 用户运行 `bun scripts/bitable-task.ts show SYMP-008`
- **THEN** 命令 SHALL 在 issue 详情后显示该 issue 的所有执行事件，按时间排序，每条显示时间戳、事件类型和关键信息。同一 identifier 的多轮 dispatch（首次 + retry）SHALL 按 `attempt` 分组展示，每组之间加分隔线。

#### Scenario: No execution history available
- **WHEN** `.symphony-execution.jsonl` 文件不存在或该 issue 无记录
- **THEN** 命令 SHALL 显示 `(no execution history)` 而非报错

### Requirement: ExecutionLog is injected via OrchestratorDeps
`ExecutionLog` SHALL 通过 `OrchestratorDeps` 依赖注入传入 Orchestrator，与 `TokenLog` 模式一致。

#### Scenario: ExecutionLog injected in cli.ts
- **WHEN** cli.ts 构造 OrchestratorDeps
- **THEN** SHALL 创建 `ExecutionLog` 实例并赋值到 `deps.executionLog`

#### Scenario: ExecutionLog is optional
- **WHEN** `OrchestratorDeps.executionLog` 未提供（undefined）
- **THEN** Orchestrator SHALL 正常运行，不记录执行日志（不抛异常）
