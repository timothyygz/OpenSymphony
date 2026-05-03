# Token Tracking 技术方案审查意见

审查范围：`openspec/changes/token-tracking/` 下的 proposal.md、design.md、tasks.md、specs/ 目录。

对照源码版本：`src/orchestrator/orchestrator.ts`、`src/orchestrator/state.ts`、`src/adapters/tracker/types.ts`、`src/adapters/tracker/feishu-bitable/adapter.ts`、`src/model/session.ts`、`src/cli.ts`。

---

## ✅ 正确的部分

1. **Bug 诊断准确**：`onWorkerExit` 确实只调用了 `addRuntimeSeconds`，从未将 `entry.tokenUsage` 汇入 `state.aggregateTotals`。`AggregateTotals` 接口（`src/model/session.ts:44`）中定义了 `inputTokens/outputTokens/totalTokens`，初始值为 0，但从未被写入——永远是 0。
2. **JSONL 追加写入方案合理**：不可变数据、零依赖、`tail -f` 友好，符合项目风格。
3. **D3（字段名可配置）和 D5（只写总 token）**：务实且向后兼容。
4. **Delta tracking 逻辑（`onAgentEvent`）**：`Math.max(0, delta)` 防止 agent 重置计数器导致的负值，已正确处理。

---

## 🔴 严重问题

### 1. 遗漏了另外两个丢失 token 的代码路径

方案只关注了 `onWorkerExit`，但代码中还有 **两处** 同样删除 running entry 却不汇总 token 的地方：

**`reconcileStalled()`**（`orchestrator.ts` 约第 275 行）：

```typescript
this.state.running.delete(issueId);
addRuntimeSeconds(this.state, entry);
this.state.claimed.delete(issueId);
scheduleRetry(...);
```

→ token 数据直接丢失，不经过 `onWorkerExit`。

**`reconcileTrackerStates()`**（`orchestrator.ts` 约第 312、322 行，terminal 和 non-active 两个分支）：

```typescript
this.state.running.delete(issueId);
addRuntimeSeconds(this.state, entry);
this.state.claimed.delete(issueId);
```

→ 同样直接丢失，不经过 `onWorkerExit`。

**影响**：stall 检测触发的 worker 终止、外部改为 terminal 状态的 issue，它们的 token 消耗既不会汇入 `aggregateTotals`，也不会写入 JSONL，更不会回写飞书。方案中对这三种情况完全没有提及。

**建议**：将 `addTokenUsage` + JSONL append + tracker update 抽成内部方法（如 `finalizeWorkerTokens`），在 `onWorkerExit`、`reconcileStalled`、`reconcileTrackerStates` 三处统一调用。或者让 `reconcileStalled`/`reconcileTrackerStates` 也走 `onWorkerExit` 路径。

---

### 2. `updateIssueTokens` 定义为"接口可选方法"在 TypeScript 中有实现问题

`tui-integration/spec.md` 写道：

> TrackerAdapter interface SHALL include an **optional** method `updateIssueTokens`
> Implementations that do not support token tracking SHALL provide a **no-op default**.

TypeScript 接口**不能提供默认实现**。`updateIssueTokens?: (...) => Promise<void>` 可选属性意味着调用方每次都要 `if (tracker.updateIssueTokens)` 检查，否则编译报错。如果忘记检查就会运行时 crash。

**建议**：改为接口上的**必需方法**，提供一个 `createNoOpTracker()` 或在基类中给 no-op 默认实现。调用方直接 `tracker.updateIssueTokens(...)` 无需判空。

---

## 🟡 中等问题

### 3. Fire-and-forget 需要明确"不 await"

`design.md` 和 spec 都说"fire-and-forget with `.catch()`"，但 `onWorkerExit` 本身是 `async` 方法。如果写成：

```typescript
await tracker.updateIssueTokens(issueId, entry.tokenUsage).catch(...)
```

虽然 catch 兜底了，但会**阻塞 exit 路径**等待飞书 API 响应。方案应明确写：**不 await**，直接：

```typescript
tracker.updateIssueTokens(issueId, entry.tokenUsage).catch((err) => {
  logger.warn({ issueId, error: String(err) }, "Token tracker update failed");
});
```

---

### 4. JSONL 文件损坏处理未指定

进程在写 JSONL 行时 crash（如 SIGKILL），最后一行可能不完整。`summary()` 如果用 `JSON.parse(line)` 会抛异常。spec 应要求 `summary()` 跳过无法解析的行并 warn。

---

### 5. 服务重启后 `aggregateTotals` 不恢复

`aggregateTotals` 是纯内存状态，重启后归零。JSONL 是"真实数据源"（D1），但方案没有说启动时是否从 JSONL 恢复 `aggregateTotals`。如果恢复，`TokenLog.summary()` 需要在 orchestrator 启动时调用。如果不恢复，TUI dashboard 在重启后会显示 0，与 JSONL 数据矛盾。

**建议**：明确是否恢复。如果恢复，在 tasks.md 增加一个任务（在 `cli.ts` 创建 orchestrator 后调用 `tokenLog.summary()` 写入初始 `aggregateTotals`）；如果不恢复，在 proposal 的 Non-Goals 中说明。

---

### 6. JSONL 文件路径应相对于 workflow 目录，而非 CWD

默认 `.symphony-tokens.jsonl` 在 CWD 下。如果以 systemd 或不同工作目录启动，文件位置不可预测。建议默认放在 workflow 文件同目录下。

---

## 🟢 小问题

### 7. D4 与实际行为不一致

D4 说："每次回写会**覆盖**之前的值"。飞书 `updateRecord` 写入数字字段是**替换**而非累加。如果 issue 重试了 3 次，飞书字段只显示最后一次的 token 数。方案中写"这是预期行为"，但运维可能误以为这是总消耗。

**建议**：字段名明确为"上次运行 Token 消耗"，或者在飞书回写时累加之前值（先读再写）。

---

### 8. TokenRecord 中 `identifier` vs `issueId` 命名歧义

spec 中 `identifier` 是 issue 编号（如 "SUDI-42"），`issueId` 是飞书 record_id。代码中 `RunningEntry.identifier` 也是 issue 编号，`issue.id` 是 record_id。需要确保 JSONL 写入时两者都记录且字段命名不混淆。

---

### 9. tasks.md 缺少 `reconcileStalled` 和 `reconcileTrackerStates` 的改动任务

对应严重问题 #1，tasks.md 应增加以下任务：

- [ ] 1.3 修改 `src/orchestrator/orchestrator.ts` — `reconcileStalled` 中在 `addRuntimeSeconds` 后调用 `addTokenUsage`
- [ ] 1.4 修改 `src/orchestrator/orchestrator.ts` — `reconcileTrackerStates` 的 terminal 和 non-active 分支中在 `addRuntimeSeconds` 后调用 `addTokenUsage`
- [ ] 4.4 修改 `src/orchestrator/orchestrator.ts` — `reconcileStalled` 中调用 `tokenLog.append()` 和 `tracker.updateIssueTokens()`
- [ ] 4.5 修改 `src/orchestrator/orchestrator.ts` — `reconcileTrackerStates` 的 terminal 和 non-active 分支中调用 `tokenLog.append()` 和 `tracker.updateIssueTokens()`

---

## 📋 总结

| 严重度 | 问题 | 建议 |
|--------|------|------|
| 🔴 严重 | 遗漏 `reconcileStalled`/`reconcileTrackerStates` 的 token 丢失 | 抽取公共 `finalizeWorkerTokens`，三处统一调用 |
| 🔴 严重 | 接口可选方法无默认实现 | 改为必需方法 + no-op 实现 |
| 🟡 中等 | fire-and-forget 应明确不 await | 方案中写明不 await |
| 🟡 中等 | JSONL 损坏行未处理 | `summary()` 跳过无效行 |
| 🟡 中等 | 重启后 aggregateTotals 不恢复 | 明确是否从 JSONL 恢复 |
| 🟡 中等 | JSONL 路径基于 CWD | 改为 workflow 目录 |
| 🟢 小 | 飞书回写是覆盖非累加 | 字段名明确或改为累加 |
| 🟢 小 | identifier/issueId 命名歧义 | 确保 JSONL 记录两者清晰 |

核心问题集中在 **#1（遗漏代码路径）** 和 **#2（接口设计）**，建议修复后再进入实施阶段。
