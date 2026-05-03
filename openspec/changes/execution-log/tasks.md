## 1. ExecutionLog Core

- [x] 1.1 创建 `src/logging/execution-log.ts`：定义事件类型（dispatch / worker_spawn_failed / session_started / turn_completed / turn_failed / worker_exit / stall_detected / retry_scheduled / tracker_state_updated）和公共字段接口。`worker_exit` 的 reason 支持 "normal" | "failed" | "stall" | "external_cancel"
- [x] 1.2 实现 `ExecutionLog` 类：构造函数接收 filePath，提供 `append(event)` 方法使用 `appendFileSync` 写入 JSONL，写入失败时通过 Pino logger.warn 记录但不抛异常。提供 `queryByIdentifier(identifier)` 方法按 identifier 过滤返回记录
- [x] 1.3 为 `ExecutionLog` 编写单元测试：验证 JSONL 写入格式、写入失败容错、多条记录追加

## 2. Orchestrator Integration

- [x] 2.1 在 `OrchestratorDeps` 接口中添加可选的 `executionLog?: ExecutionLog` 字段
- [x] 2.2 在 `dispatchIssue()` 中记录 `dispatch` 事件（`attempt` 从 null 规范化为 0），在 worker spawn 失败的 catch 块中记录 `worker_spawn_failed` 事件（注意：此时 entry 已从 state.running 删除，issueId/identifier 应从 `issue` 参数直接获取）
- [x] 2.3 在 `runWorker()` 中记录 `session_started`、`turn_completed`、`turn_failed` 事件
- [x] 2.4 在 `onWorkerExit()` 中记录 `worker_exit` 事件
- [x] 2.5 在 `reconcileStalled()` 中记录 `stall_detected` 事件，并在之后记录 `{ event: "worker_exit", reason: "stall" }` 事件
- [x] 2.6 在 `reconcileTrackerStates()` 的 terminal state 分支中记录 `{ event: "worker_exit", reason: "normal" }` 事件；在 non-active state 分支中记录 `{ event: "worker_exit", reason: "external_cancel" }` 事件
- [x] 2.7 在 `scheduleRetry()` 调用处记录 `retry_scheduled` 事件
- [x] 2.8 在 tracker 状态更新处记录 `tracker_state_updated` 事件（fromState / toState）
- [x] 2.9 更新现有 Orchestrator 测试，验证 ExecutionLog 在未注入时不影响调度

## 3. CLI Wiring

- [x] 3.1 在 `src/cli.ts` 中构造 `.symphony-execution.jsonl` 路径并创建 `ExecutionLog` 实例，注入到 `OrchestratorDeps`

## 4. CLI Query

- [x] 4.1 在 `scripts/bitable-task.ts` 的 `show` 命令中，读取 `.symphony-execution.jsonl` 并按 identifier 过滤显示执行事件时间线。多轮 dispatch 按 attempt 分组，组间显示分隔线
- [x] 4.2 文件不存在或无记录时显示 `(no execution history)`

## 5. Verification

- [x] 5.1 `bun test` 全部通过
