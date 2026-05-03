## Context

当前 token 追踪存在的问题：

1. **Bug**: `onWorkerExit` 调用 `addRuntimeSeconds(state, entry)` 只汇总了运行时间，没有汇总 `entry.tokenUsage` 到 `state.aggregateTotals`。TUI dashboard 的 aggregateTotals 数据永远不准确。
2. **Bug**: `reconcileStalled()` 和 `reconcileTrackerStates()` 也有同样问题——删除 running entry 时只调用 `addRuntimeSeconds`，不汇总 token。stall 检测和外部状态变更导致的 worker 终止同样丢失 token 数据。
3. **数据丢失**: 所有删除 running entry 的路径（3 条）都会丢失 per-issue token 明细。
4. **飞书表格无 token 字段**: 运维只能在 TUI 或日志中看 token，无法在飞书任务管理界面直接查看。

删除 running entry 的 3 条代码路径：
- `onWorkerExit` — worker 正常/失败退出
- `reconcileStalled` — stall 检测终止 worker
- `reconcileTrackerStates` — 外部状态变为 terminal 或 non-active

## Goals / Non-Goals

**Goals:**
- 修复 aggregateTotals 汇总 bug（3 条路径全部修复）
- 持久化 per-issue token 记录到 JSONL 文件
- 在飞书多维表格中回写 token 消耗字段（完成和失败时都写）

**Non-Goals:**
- 不计算费用/成本
- 不做 token 数据的查询/聚合 API
- 不改动飞书表格的字段创建（用户需自行在飞书创建数字类型字段）
- 不从 JSONL 恢复 aggregateTotals（aggregateTotals 代表本次运行会话，重启归零；JSONL 是跨会话的累计记录）
- 不累加飞书字段的历史值（回写是覆盖，显示"本次运行"的 token；完整历史在 JSONL）

## Decisions

### D1: JSONL 追加写入，不用数据库

**选择**: 每次写入一行 JSON 到 `<workflow-dir>/.symphony-tokens.jsonl`
**替代方案**: SQLite、写入飞书作为唯一记录源、CWD 下放文件
**理由**: 只追加写、不可变数据、`tail -f` 可实时查看。零依赖，Bun 原生 `Bun.write` 支持 append 模式。飞书回写是辅助展示，JSONL 是真实数据源。路径放在 workflow 目录下而非 CWD，确保 systemd 等场景下位置可预测。

### D2: TrackerAdapter 接口新增必需方法

**选择**: 新增必需方法 `updateIssueTokens(issueId: string, tokens: TokenUsage): Promise<void>`，不需要 token 追踪的 adapter 提供 no-op 实现
**替代方案**: 可选方法 `updateIssueTokens?`、在 `updateIssueState` 里加参数
**理由**: TypeScript 接口的可选方法要求调用方每次 `if (tracker.updateIssueTokens)` 检查，容易遗漏。必需方法 + no-op 实现让调用方直接调用，编译器保证安全。

### D3: 飞书字段名通过配置传入

**选择**: `FeishuBitableConfig` 新增可选 `tokensField` 字段
**替代方案**: 硬编码字段名 "Token消耗"
**理由**: 飞书多维表格的字段名由用户自定义，不同项目可能不同。不配置时飞书 adapter 的 `updateIssueTokens` 为 no-op，向后兼容。

### D4: 三条路径统一处理

**选择**: 抽取 `finalizeWorkerTokens(entry)` 私有方法，在 `onWorkerExit`、`reconcileStalled`、`reconcileTrackerStates` 三处统一调用
**替代方案**: 让 reconcile 路径也走 `onWorkerExit`
**理由**: `onWorkerExit` 包含了 tracker 状态更新和 retry 逻辑，不适合被 reconcile 直接调用（reconcile 有自己的状态更新逻辑）。抽取公共方法更干净，确保三条路径都不会遗漏 token 汇总、JSONL 写入和飞书回写。

### D5: Token 回写值用本次运行总量

**选择**: 回写 `entry.tokenUsage.totalTokens`（本次运行的总 token 数）
**替代方案**: 回写 input/output 分别的字段、先读后写累加
**理由**: 用户说"只需要记录 tokens"，一个字段就够了。先读后写增加 API 调用和竞态风险。字段显示"本次运行 Token"，完整历史在 JSONL。

### D6: 飞书回写为 fire-and-forget（不 await）

**选择**: `tracker.updateIssueTokens(...)` 不 await，用 `.catch()` 兜底
**替代方案**: await 后再继续退出流程
**理由**: `onWorkerExit` 是 async 方法，await 飞书 API 会阻塞 worker 退出路径。token 回写是辅助操作，不应影响主流程时序。

## Risks / Trade-offs

**[飞书 API 写入失败]** → 网络或权限问题导致回写失败。缓解：不 await，`.catch()` 只 warn 不阻塞。JSONL 文件确保本地数据不丢。

**[JSONL 文件增长]** → 长期运行文件会变大。缓解：JSONL 每行很小（~200 字节），10 万条约 20MB，可接受。后续可加按天轮转。

**[JSONL 损坏行]** → 进程 crash 时最后一行可能不完整。缓解：`summary()` 逐行 try-catch，跳过无法解析的行并 warn。

**[重试 issue 的飞书字段覆盖]** → 同一 issue 多次运行，每次回写覆盖之前的值。缓解：这是预期行为——字段显示"本次运行 Token"。完整历史在 JSONL 文件中。建议在 WORKFLOW.md 中字段名配置为 "本次运行Token" 以避免误解。

**[aggregateTotals 重启归零]** → 重启后 TUI dashboard 显示 0。缓解：这是预期行为，aggregateTotals 代表本次会话。JSONL 文件保存跨会话的完整记录。
