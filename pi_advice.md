# Symphony 实现建议（基于 SPEC.md 对比 openspec 文档）

> 对比原始 Symphony SPEC.md 与本地 openspec/changes/symphony-service-v1/ 下的 proposal.md、design.md、tasks.md，
> 发现的遗漏和需要补充的点。

---

## 🔴 关键遗漏（与 SPEC 差异较大）

### 1. `blocked_by` 的实现缺失

**SPEC Section 4.1.1 / 8.2**：Issue 有 `blocked_by` 字段，且 Todo 状态的 issue 如果有非终止态 blocker 则不可调度。

**design.md 中**：飞书字段映射写了 `(无直接映射) → blocked_by []`，但 Spec 要求 Todo 状态的 issue 在有未完成 blocker 时不予 dispatch。

**建议补充**：
- design.md 应明确说明飞书场景下 blocker 语义的处理方式：是忽略（`blocked_by` 永远为空）还是通过某种关联字段实现
- 如果忽略，应在 proposal 的 "Technical Decisions" 或 design 中记录此决策和理由

### 2. 状态归一化规则不完整

**SPEC Section 4.2**：所有 state 比较前要 `lowercase`。

**design.md**：并发控制代码中用了 `toLowerCase()`，但飞书多维表格的 "状态" 是**单选字段**，值可能是中文（如 `"待处理"`、`"进行中"`）。中文 lowercase 后不变，但如果配置中写 `active_states: ["待处理", "进行中"]`，需要确保 tracker adapter 返回的 state 和 config 中的 active/terminal states 比较逻辑一致。

**建议补充**：design.md 中明确 state 比较的归一化策略（是 lowercase？还是精确匹配？还是配置和 tracker 值的 trim + casefold？）

### 3. Turn continuation 的 prompt 语义

**SPEC Section 7.1**：第一个 turn 用完整渲染 prompt，continuation turn 只发送 continuation guidance，不重发原始 prompt。

**design.md Section 3.2**：写了 `--continue` 模式，但没有定义 continuation guidance 具体是什么内容。

**建议补充**：明确 continuation turn 发送的 prompt 内容。例如：
- 是否只是 `Continue working on this issue. Issue state is still active.` 之类的简短提示？
- 还是包含最新的 issue 状态刷新信息？
- Spec 说 `attempt` 变量可用于模板区分首次/续跑/重试，design 中应说明模板如何处理

### 4. Claude Code 没有 session 驻留 —— session 元数据存储未定义

**design.md Section 3.1** 写了 "session 元数据存在文件系统中"，但没给出具体方案。

**建议补充**：
- `--continue` / `--resume` 依赖 Claude Code 在 `~/.claude/` 下的会话历史。每次 `--continue` 时 session 是怎么关联的？靠 workspace cwd？还是靠某个 session ID？
- 是否需要显式 `--session-id` 或 `--resume <session-id>`？
- 如果 Claude Code 的 continuation 是按 cwd 自动关联的，多个 issue 在同一机器上并行运行是否会冲突？

### 5. Worker 的 turn loop 中 issue 状态刷新

**SPEC Section 16.5**：每次 turn 完成后，worker 要主动刷新 issue 状态，如果仍 active 才继续下一个 turn。

**design.md Section 3.2**：流程图中写了 "turn 完成 → 检查 issue 状态"，但 `design.md Section 5` 的 Orchestrator 设计中没有体现 turn loop 内部的 tracker 调用。Agent Adapter 的 `runTurn` 接口也没有提供 tracker 访问能力。

**建议补充**：明确 turn loop 中 issue 状态刷新是 Agent Adapter 的责任还是 Orchestrator worker 的责任。按照 Spec 参考算法（Section 16.5），这是 worker attempt 函数内部的逻辑，应在 design 中体现。

---

## 🟡 中等遗漏（应该补充但影响较小）

### 6. Hook 执行的超时机制

**SPEC Section 5.3.4**：所有 hooks 共享 `hooks.timeout_ms`（默认 60s）。

**design.md**：tasks 中提到了 timeout，但 design 没有说明实现方式（`AbortController`？`setTimeout + kill`？Bun 的 `subprocess` 超时？）。

### 7. Retry 的 continuation vs failure 区分

**SPEC Section 8.4**：
- 正常退出 → continuation retry，固定 1000ms
- 异常退出 → 指数退避，`min(10000 * 2^(attempt-1), max_retry_backoff_ms)`

**design.md Section 5.2**：状态机画了区分，但 delay 公式没有在 design 文档中写明具体数值。建议补充明确。

### 8. Startup Terminal Workspace Cleanup

**SPEC Section 8.6**：服务启动时查询终止态 issues 并清理对应 workspace。

**tasks.md T34** 有提及，但 design.md 的 Orchestrator 设计中没有体现这个流程。建议在 Section 5 中补充 startup 流程。

### 9. `$VAR` 为空时的处理

**SPEC Section 5.3.1**：`If $VAR_NAME resolves to an empty string, treat the key as missing.`

**design.md Section 2** 提到 `$VAR` 解析，但没有说明空字符串 = 缺失的语义。这是一个校验细节。

### 10. Claude Code 的 stall detection

**SPEC**：orchestrator 基于 `last_codex_timestamp` 判断 stall。

**问题**：Claude Code 每次 turn 是独立进程调用，stdout 是同步阻塞读取的。如果进程卡住不输出，read 会一直等待。stall detection 在 Claude Code 场景下如何工作？

**建议补充**：说明 stall detection 在 Claude Code adapter 中如何实现——是靠 turn_timeout_ms 覆盖，还是需要额外的进程级超时？

### 11. `max_concurrent_agents_by_state` 的 state 来源

**SPEC**：per-state 并发限制的 state key 用的是 tracker 返回的原始 state（normalized lowercase）。

**飞书场景**：state 来自单选字段的中文值。如果 config 中写 `max_concurrent_agents_by_state: { "进行中": 3 }`，需要确保和 tracker 返回值的匹配逻辑正确。

---

## 🟢 小问题（可以后续处理）

### 12. WORKFLOW.md 模板引擎选择

**SPEC Section 5.4**：要求 "strict template engine（Liquid-compatible semantics）"，未知变量/过滤器必须报错。

**design.md T7**：只写了 "模板变量替换"，没有指定用什么引擎。Bun/TS 生态中有 `liquidjs`、`eta`、`nunjucks` 等选择，建议明确。

### 13. 测试矩阵覆盖度

**SPEC Section 17**：有详细的测试矩阵（Workflow/Config/Workspace/Tracker/Orchestrator/Agent/Observability/CLI 共 8 个维度）。

**tasks.md**：只有 T15、T19、T24 是显式的测试任务。建议对照 Spec Section 17 补充更细的测试任务。

### 14. 日志的 `session_id` 格式

**SPEC**：`session_id = <thread_id>-<turn_id>`。

**Claude Code 场景**：没有 thread_id/turn_id 概念。design 应说明 session_id 如何生成（UUID？workspace key + timestamp？）。

### 15. `codex_totals.seconds_running` 的聚合方式

**SPEC Section 13.5**：对已结束 session 累加 duration，对活跃 session 在 snapshot 时动态计算。

design.md 的 state 中有此字段，但没有说明聚合逻辑。

---

## 总结

| 优先级 | 事项 | 说明 |
|--------|------|------|
| 🔴 高 | `blocked_by` 语义 | 飞书场景下明确如何处理（忽略 vs 映射） |
| 🔴 高 | Turn continuation prompt 内容 | Spec 要求不重发原始 prompt，需定义 guidance |
| 🔴 高 | Claude Code session 关联机制 | `--continue` 如何跨 turn 关联会话 |
| 🔴 高 | Turn loop 内 issue 状态刷新 | worker 内部还是 adapter 内部 |
| 🟡 中 | Stall detection 适配 | Claude Code 无驻留进程，stall 怎么检测 |
| 🟡 中 | Startup cleanup 流程 | design 中补充 |
| 🟡 中 | 状态归一化策略 | 中文 state 的比较规则 |
| 🟡 中 | Retry delay 公式 | 写明具体数值 |
| 🟢 低 | 模板引擎选择 | 明确用哪个库 |
| 🟢 低 | session_id 生成规则 | 替代 Codex 的 thread-turn 格式 |
| 🟢 低 | 测试矩阵细化 | 对照 Spec Section 17 |
