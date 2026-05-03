# Execution Log 技术方案评审建议

## 总体评价

方案设计思路清晰、与现有 `TokenLog` 模式一致、对现有代码侵入性低。以下按严重程度列出发现的问题。

---

## 🔴 P0：stall / reconcileTracker 路径缺少 worker_exit 事件

**现状**：`reconcileStalled()` 和 `reconcileTrackerStates()` 在检测到 stall / terminal state / non-active state 时，直接从 `state.running` 中删除 entry，调用 `finalizeWorkerTokens()` 后结束——**不经过 `onWorkerExit()`**。

**影响**：
- stall 导致的 worker 终止：只记录了 `stall_detected`，没有对应的 `worker_exit` 事件
- tracker reconcile 导致的 worker 终止（terminal / non-active）：没有任何事件记录

这意味着执行日志在这些场景下会出现"断档"——有 `dispatch` 但没有 `worker_exit`，无法通过日志完整还原 issue 的生命周期。

**建议**：
1. 在 `reconcileStalled()` 中，记录 `stall_detected` 之后再记录一条 `{ event: "worker_exit", reason: "stall", ... }`
2. 在 `reconcileTrackerStates()` 的 terminal state 分支中记录 `{ event: "worker_exit", reason: "normal" | "failed" | "external_cancel", ... }`（可根据状态决定 reason）
3. 在 `reconcileTrackerStates()` 的 non-active state 分支中记录 `{ event: "worker_exit", reason: "external_cancel", ... }`
4. 或者，将这些路径统一收拢到 `onWorkerExit()` 中，避免遗漏

**涉及文件**：
- `design.md` Decisions #2 补充事件类型定义（如 `worker_exit` 的 reason 增加 `"external_cancel"` 值）
- `spec.md` 补充 reconcile 路径下的 Scenario
- `tasks.md` 2.4 明确覆盖 `reconcileStalled()` 和 `reconcileTrackerStates()` 的 worker_exit 记录

---

## 🟡 P1：`turn_started` 事件定义与 spec/tasks 不一致

**现状**：
- `design.md` Decisions #2 的 `ExecutionEvent` 类型定义中包含 `{ event: "turn_started"; turn: number }`
- `spec.md` 中**没有** `turn_started` 的 Scenario
- `tasks.md` 2.3 只提到 `session_started`、`turn_completed`、`turn_failed`，未提及 `turn_started`

**影响**：三份文档不一致，实现时会产生歧义。

**建议**：二选一——
- **方案 A（保留）**：在 spec.md 和 tasks.md 中补充 `turn_started` 的 Scenario 和任务项
- **方案 B（删除）**：从 design.md 的事件类型定义中删除 `turn_started`。理由是代码中 turn loop 的开始没有显著的副作用点，`turn_completed` 和 `turn_failed` 已足够覆盖

---

## 🟡 P2：`dispatch` 事件的 `attempt` 字段可能为 null

**现状**：`design.md` 定义 `{ event: "dispatch"; attempt: number }`，但 `orchestrator.ts` 中 `dispatchIssue(issue, attempt: number | null)` 首次调用时 `attempt` 为 `null`（见 tick() 中的 `this.dispatchIssue(issue, null)`）。

**建议**：类型改为 `attempt: number | null`，或在记录时统一转为数字：`attempt: attempt ?? 0`。后者更简洁，且与 retry 场景的语义一致。

---

## 🟡 P3：CLI 展示多个 run 时缺乏分组

**现状**：spec 只要求 "按时间排序，每条显示时间戳、事件类型和关键信息"。但同一个 identifier 可能有多轮 dispatch（首次 + retry），平铺展示时用户难以区分不同 run。

**建议**：
- 展示时按 `sessionId` 或 `attempt` 分组，每组之间加分隔线
- 或至少在 `dispatch` 事件行高亮 `attempt` 编号，作为新一轮执行的起点标记

---

## 🟢 P4：多实例共享 JSONL 文件的并发写入

**现状**：design.md 的 Risk 章节提到了文件增长和同步写入性能，但没有提及多实例场景。

**分析**：`appendFileSync` 在 POSIX 系统上，对小于 `PIPE_BUF`（通常 512-4096 字节）的写入是原子的。单条 JSONL 约 200-500 字节，通常在安全范围内。但如果事件包含长 error message，可能超出阈值导致行交错。

**建议**：在 Risk 章节补充说明：
> 单实例部署无并发写入问题。多实例共享同一 `.symphony-execution.jsonl` 时，依赖 OS 的 append 原子性，单行超过 PIPE_BUF 的极端情况可能出现行交错。多实例场景建议每个实例使用独立日志文件。

---

## 🟢 P5：`worker_spawn_failed` 记录时机需注意 entry 生命周期

**现状**：`dispatchIssue()` 中，先创建 entry 加入 `state.running`，然后在 `runWorker().catch()` 中删除 entry 并调度 retry。`worker_spawn_failed` 需要在这个 catch 块中记录。

**注意点**：catch 块中 entry 已被从 `state.running` 删除，记录日志所需的 `issueId` 和 `identifier` 应从 `issue` 参数直接获取（而非从 state 中查找），实现时需留意。

这不是设计问题，但建议在 tasks 中加一条备注提醒实现者。

---

## 建议的文档修改清单

| 文件 | 修改内容 |
|------|----------|
| `design.md` Decisions #2 | 补充 `worker_exit` reason 的 `"external_cancel"` 值；解决 `turn_started` 去留 |
| `spec.md` | 补充 reconcile 路径下的 worker_exit Scenario；如保留 turn_started 则补充对应 Scenario |
| `tasks.md` | 2.4 明确覆盖 `reconcileStalled()` 和 `reconcileTrackerStates()` 的事件记录；如保留 turn_started 则补充任务项 |
| `design.md` Risks | 补充多实例并发写入的说明 |
