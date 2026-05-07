## Why

GitLab Issues adapter 的本体代码（api/mapper/adapter/register）已实现，但与现有 specs 描述的目标状态之间存在显著差距：`TrackerAdapter` 接口缺少 `createIssue`/`searchIssues`/`healthCheck` 方法，MCP tool 仍绑定 `FeishuBitableApi`，init/doctor 命令仍硬编码飞书逻辑，配置体系未扩展，且 adapter 未注册到 `cli.ts`。需要补齐这些集成工作使多 tracker 架构真正可用。

## What Changes

- **BREAKING**: `TrackerAdapter` 接口新增必选方法 `createIssue`、`searchIssues`，将 `getMcpServerConfig` 从可选改为必选；新增可选方法 `healthCheck`
- 新增 `CreateIssueData`、`HealthCheckResult` 类型定义到 `src/adapters/tracker/types.ts`
- 重构 `tracker-tools.ts`：从 `createBitableTool(api: FeishuBitableApi)` 改为 `createTrackerTool(adapter: TrackerAdapter)`，基于接口实现 5 个 action
- 更新 `worker-runner.ts`：移除 `instanceof FeishuBitableAdapter` 检查，通过 `tracker.getMcpServerConfig()` 获取 MCP 配置
- 飞书 adapter 补齐 `createIssue`、`searchIssues`、`healthCheck` 方法
- `registerTracker` 扩展为接受可选 setup 函数参数
- 重构 init 命令：增加 tracker 类型选择步骤，按 kind 路由到对应 setup 函数
- 重构 doctor 命令：移除硬编码飞书检查，改为调用 `adapter.healthCheck()`
- 重构 `GlobalSettings.tracker` 为通用结构，配置校验按 kind 动态分发
- 修复 `cli.ts` dashboard URL 硬编码飞书域名
- 在 `cli.ts` 中注册 gitlab-issues adapter

## Capabilities

### New Capabilities

无。所有 capability 的 specs 已存在于 `openspec/specs/` 中。

### Modified Capabilities

无。现有 specs 已描述了目标状态，本次变更纯粹是实现层面的补齐。

## Impact

- **核心接口**: `TrackerAdapter` 接口变更新增 3 个方法 + 1 个从可选变必选
- **新增类型**: `CreateIssueData`、`HealthCheckResult`
- **重构文件**: `types.ts`, `tracker-tools.ts`, `worker-runner.ts`, `feishu-bitable/adapter.ts`, `registry.ts`, `init-core.ts`, `doctor.ts`, `config.ts`, `cli.ts`
- **注册文件**: `gitlab-issues/register.ts` 需修复不存在的 `TrackerSetupFn` 导入
- **测试**: 需新增 GitLab adapter、通用 tracker tool、飞书新方法的测试
