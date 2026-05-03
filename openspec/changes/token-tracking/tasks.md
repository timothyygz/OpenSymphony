## 1. Bug fix: aggregateTotals 汇总（3 条路径）

- [x] 1.1 修改 `src/orchestrator/state.ts` — 新增 `addTokenUsage(state, entry)` 函数，将 `entry.tokenUsage` 的 inputTokens/outputTokens/totalTokens 累加到 `state.aggregateTotals`
- [x] 1.2 修改 `src/orchestrator/orchestrator.ts` — 抽取 `finalizeWorkerTokens(entry)` 私有方法：调用 `addTokenUsage` + `tokenLog.append()` + `tracker.updateIssueTokens()` (fire-and-forget, 不 await)
- [x] 1.3 修改 `src/orchestrator/orchestrator.ts` — `onWorkerExit` 中在 `addRuntimeSeconds` 后调用 `finalizeWorkerTokens`
- [x] 1.4 修改 `src/orchestrator/orchestrator.ts` — `reconcileStalled` 中在 `addRuntimeSeconds` 后调用 `finalizeWorkerTokens`
- [x] 1.5 修改 `src/orchestrator/orchestrator.ts` — `reconcileTrackerStates` 的 terminal 和 non-active 两个分支中在 `addRuntimeSeconds` 后调用 `finalizeWorkerTokens`

## 2. JSONL 持久化

- [x] 2.1 创建 `src/metrics/token-log.ts` — `TokenRecord` 接口（identifier, issueId, inputTokens, outputTokens, totalTokens, turns, retryAttempt, completedAt）、`TokenLog` 类：`append(record)` 追加 JSON 行到文件、`summary()` 读取并汇总（跳过损坏行并 warn）。文件路径默认为 workflow 目录下 `.symphony-tokens.jsonl`

## 3. TrackerAdapter 接口扩展

- [x] 3.1 修改 `src/adapters/tracker/types.ts` — `TrackerAdapter` 新增必需方法 `updateIssueTokens(issueId: string, tokens: TokenUsage): Promise<void>`
- [x] 3.2 修改 `src/adapters/tracker/feishu-bitable/adapter.ts` — `FeishuBitableConfig` 新增可选 `tokensField`；实现 `updateIssueTokens`：若 `tokensField` 存在则调用 `api.updateRecord` 写入 `totalTokens`，否则立即 resolve（no-op）
- [x] 3.3 修改 `src/adapters/tracker/feishu-bitable/adapter.ts` — `createFeishuBitableAdapter` 解析 `tokens_field` 配置项传入 `tokensField`
- [x] 3.4 修改 `src/adapters/tracker/memory.ts` — `MemoryTrackerAdapter` 实现 `updateIssueTokens` 为 no-op

## 4. Orchestrator 集成

- [x] 4.1 修改 `src/orchestrator/orchestrator.ts` — 构造函数通过 deps 接收 `TokenLog` 实例
- [x] 4.2 修改 `src/cli.ts` — 创建 `TokenLog` 实例（路径为 workflow 目录下）并传入 Orchestrator deps

## 5. 测试

- [x] 5.1 为 `token-log.ts` 编写单元测试：append 写入、summary 汇总、损坏行跳过、文件不存在时创建
- [x] 5.2 为 `addTokenUsage` 编写单元测试：累加正确性、多次调用
