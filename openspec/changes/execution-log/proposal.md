## Why

当前 Orchestrator 的调度日志仅输出到 Pino console（stdout/stderr），进程退出即丢失。当任务执行失败（如 SYMP-008 turns=0 静默退出）时，无法事后排查原因——dispatch、turn 执行、stall 检测、retry 等关键事件都没有持久化记录。

## What Changes

- 新增 JSONL 格式的执行日志文件（`.symphony-execution.jsonl`），记录 Orchestrator 全生命周期的结构化事件
- 在 Orchestrator 的关键路径（dispatch、turn 开始/完成、worker 退出、stall 检测、retry 调度、tracker 状态变更）中写入执行日志
- 日志路径基于 WORKFLOW.md 位置自动推导（与现有 `.symphony-tokens.jsonl` 一致）
- 扩展 `bitable-task.ts` 的 `show` 命令，支持显示任务的历史执行记录

## Capabilities

### New Capabilities
- `execution-log`: 结构化执行日志的写入、存储与查询能力。覆盖 Orchestrator 生命周期事件记录、JSONL 文件管理、以及 CLI 查询接口。

### Modified Capabilities

（无）

## Impact

- `src/orchestrator/orchestrator.ts` — 在 dispatch/runWorker/onWorkerExit/reconcileStalled 等方法中调用执行日志记录
- `src/logging/logger.ts` — 可能扩展，或新增独立的 `ExecutionLog` 类
- `src/cli.ts` — 传递 execution log 路径到 OrchestratorDeps
- `scripts/bitable-task.ts` — `show` 命令增加执行历史展示
- 新增测试文件覆盖日志写入与查询
