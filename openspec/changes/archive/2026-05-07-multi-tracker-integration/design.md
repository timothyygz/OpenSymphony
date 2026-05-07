## Context

GitLab Issues adapter 的本体代码（`src/adapters/tracker/gitlab-issues/` 下的 api.ts、mapper.ts、adapter.ts、register.ts）已完整实现，但集成层的 6 个关键位置仍硬编码飞书逻辑：

1. `TrackerAdapter` 接口缺少 `createIssue`/`searchIssues`/`healthCheck` 方法，`getMcpServerConfig` 仍为可选
2. `tracker-tools.ts` 接受 `FeishuBitableApi` 而非 `TrackerAdapter`
3. `worker-runner.ts` 用 `instanceof FeishuBitableAdapter` 获取 MCP 配置
4. `doctor.ts` 硬编码 `checkFeishuAuth` / `checkBitableAccess`
5. `init-core.ts` 直接进入飞书流程，无 tracker 类型选择
6. `cli.ts` dashboard URL 硬编码飞书域名，且未导入 gitlab-issues register

此外 `gitlab-issues/register.ts` 导入了不存在的 `TrackerSetupFn` 类型，导致编译错误。

## Goals / Non-Goals

**Goals:**
- 补齐 `TrackerAdapter` 接口，使 `createIssue`/`searchIssues`/`getMcpServerConfig` 成为必选方法，`healthCheck` 为可选
- 重构 MCP tool 层为通用实现，基于 `TrackerAdapter` 接口而非 `FeishuBitableApi`
- 飞书 adapter 实现新增接口方法
- init/doctor/config 按 tracker `kind` 动态路由
- 修复 gitlab-issues register.ts 的编译错误并在 cli.ts 中注册
- 编写测试覆盖核心变更

**Non-Goals:**
- 不改动 `Issue` 域模型
- 不改动 agent adapter 体系
- 不迁移现有飞书用户的配置数据
- 不实现 GitLab adapter 的高级操作（assignee、MR 关联等）

## Decisions

### D1: TrackerAdapter 接口变更策略

在 `types.ts` 中新增 `createIssue` 和 `searchIssues` 为必选方法，将 `getMcpServerConfig` 从 `getMcpServerConfig?` 改为 `getMcpServerConfig`（必选）。新增 `healthCheck?` 可选方法和 `CreateIssueData`、`HealthCheckResult` 类型。

- 候选方案 A：所有新方法均为可选 → 无法保证 agent MCP tool 的 create/search 功能可用
- **选择必选**：`createIssue`/`searchIssues`/`getMcpServerConfig` 是 tracker tool 5 个 action 的基础，必须保证存在。`healthCheck` 允许可选以降低迁移成本。

### D2: MCP Tool 重构方式

将 `createBitableTool(api: FeishuBitableApi, issueId)` 重构为 `createTrackerTool(adapter: TrackerAdapter, issueId: string)`，内部通过 `adapter.createIssue()`/`adapter.searchIssues()` 等接口方法实现，而非直接操作 Bitable API。

- 候选方案 A：保留 `createBitableTool`，新增 `createGenericTrackerTool` → 维护两套代码，飞书走 Bitable 原生操作（如 raw fields），通用走 adapter
- **选择统一重构**：一个 `createTrackerTool` 基于接口实现，所有 tracker 统一路径。飞书 adapter 通过 Bitable API 实现接口方法即可。

### D3: Init 命令路由 — Registry 扩展

扩展 `registerTracker` 签名为 `registerTracker(kind, factory, setupFn?)`，新增 `TrackerSetupFn` 类型。init 流程先展示可用 tracker kinds，选择后调用对应 setup 函数。飞书现有 init 逻辑（`stepTracker`）封装为 setup 函数注册。

- 候选方案 A：独立于 registry，在 init-core 中 if/else 按 kind 分发 → 回到硬编码老路
- **选择 Registry 扩展**：保持 "新增 tracker 只需实现 + 注册" 的架构目标

### D4: Doctor 命令路由 — healthCheck 接口

移除 `checkFeishuAuth`/`checkBitableAccess` 硬编码函数，改为通过 registry 创建 adapter 实例并调用 `adapter.healthCheck()`。当 adapter 未实现 `healthCheck` 时，显示 "skipped" 警告。

- 候选方案 A：保留飞书硬编码 + 新增 gitlab 硬编码分支 → 每种 tracker 都需改 doctor
- **选择接口方法**：doctor 与具体 tracker 解耦，新增 tracker 自动获得健康检查支持

### D5: 配置体系 — 按需扩展

`trackerConfigSchema` 添加 GitLab 字段（`gitlab_host`、`gitlab_token`、`project_id`、`label_prefix`）为 optional。`GlobalSettings.tracker` 从 `{ feishu: {...} }` 改为 `{ [kind: string]: {...} }` 通用结构。`validateDispatchConfig` 添加 `gitlab_issues` 分支。`buildServiceConfig` 中 global settings merge 按 kind 分发。

### D6: Dashboard URL — Adapter 方法

在 `TrackerAdapter` 接口新增可选方法 `getDashboardUrl?(): string | null`。飞书返回 Bitable URL，GitLab 返回 project issues URL，不支持时返回 null。`cli.ts` 调用 `tracker.getDashboardUrl()` 获取 URL。

## Risks / Trade-offs

- **[Risk] 接口变更是 BREAKING CHANGE** → 飞书 adapter 需同步实现 `createIssue`/`searchIssues`，否则编译失败。此为预期行为，保证一致性。
- **[Risk] MCP tool 参数模型差异** → 飞书 create/update 用 raw fields (Bitable 字段名)，通用 tool 用 title/description/state。统一为通用参数，飞书 adapter 内部做字段映射。
- **[Trade-off] Registry 存储 setup 函数** → registry 从简单 Map 扩展为存储 factory + setupFn 的复合结构。牺牲了 registry 的极简性，但换取了 init 流程的可扩展性。
