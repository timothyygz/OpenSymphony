## Why

当前 orchestrator 在 worker 退出时丢失了 per-issue 的 token 消耗数据：`onWorkerExit` 删除 running entry 时没有将 tokenUsage 汇入 aggregateTotals，且完成后只保留 issue ID（`completed: Set<string>`），无法回答"每个 issue 消耗了多少 token"。同时飞书多维表格中没有 token 消耗字段，运维无法在任务管理界面直接查看成本。

## What Changes

- 修复 bug：`onWorkerExit` 将 `entry.tokenUsage` 汇入 `state.aggregateTotals`
- 新增 JSONL 持久化：每次 worker 退出时追加一条 token 记录到 `.symphony-tokens.jsonl`
- 飞书多维表格回写：worker 完成或失败时，调用 `updateRecord` 将 token 消耗写入飞书表格的新字段
- `TrackerAdapter` 接口新增 `updateIssueTokens` 方法
- `FeishuBitableConfig` 新增 `tokensField` 配置项
- TUI Dashboard header 从 aggregateTotals 读取数据（已有，无需改动）

## Capabilities

### New Capabilities
- `token-persistence`: JSONL 文件持久化 token 消耗记录，每次 worker 退出追加一条记录

### Modified Capabilities
- `tui-integration`: `TrackerAdapter` 接口新增 `updateIssueTokens` 方法；飞书多维表格 adapter 实现 token 字段回写

## Impact

- **Bug fix**: `src/orchestrator/orchestrator.ts` — `onWorkerExit` 里汇入 tokenUsage 到 aggregateTotals（1 行）
- **新增文件**: `src/metrics/token-log.ts`（~40 行）
- **修改接口**: `src/adapters/tracker/types.ts` — TrackerAdapter 新增方法
- **修改实现**: `src/adapters/tracker/feishu-bitable/adapter.ts` — 实现 token 字段回写
- **修改配置**: `src/adapters/tracker/feishu-bitable/adapter.ts` — 新增 `tokensField` 配置
- **修改调用**: `src/orchestrator/orchestrator.ts` — exit 时写入 token log 并回写 tracker
- **零新依赖**: 使用 Bun.file 追加写入 JSONL
