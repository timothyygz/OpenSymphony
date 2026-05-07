## 1. TrackerAdapter 接口扩展

- [x] 1.1 在 `src/adapters/tracker/types.ts` 中定义 `CreateIssueData` 类型（`{ title: string; description?: string; state?: string; labels?: string[] }`）和 `HealthCheckResult` 类型（`{ name: string; status: "pass" | "fail"; message?: string }`）
- [x] 1.2 将 `TrackerAdapter.getMcpServerConfig` 从可选（`?`）改为必选方法
- [x] 1.3 在 `TrackerAdapter` 接口中新增必选方法 `createIssue(data: CreateIssueData): Promise<Issue>`
- [x] 1.4 在 `TrackerAdapter` 接口中新增必选方法 `searchIssues(query: string): Promise<Issue[]>`
- [x] 1.5 在 `TrackerAdapter` 接口中新增可选方法 `healthCheck(): Promise<HealthCheckResult[]>`
- [x] 1.6 在 `TrackerAdapter` 接口中新增可选方法 `getDashboardUrl(): string | null`

## 2. 通用 Tracker MCP Tool 重构

- [x] 2.1 重构 `src/adapters/agent/claude-code/tracker-tools.ts`：将 `createBitableTool(api: FeishuBitableApi, issueId)` 改为 `createTrackerTool(adapter: TrackerAdapter, issueId: string)`，基于接口方法实现 list/get/create/update/search 五个 action
- [x] 2.2 更新 `createTrackerMcpServer` 函数签名，接受 `TrackerAdapter` 而非 `FeishuBitableApi`
- [x] 2.3 更新 `worker-runner.ts`：移除 `instanceof FeishuBitableAdapter` 检查和 `FeishuBitableAdapter` 导入，改为通过 `tracker.getMcpServerConfig(issue.id)` 获取 MCP 配置
- [x] 2.4 将 `worker-runner.ts` 中 tracker guidance prompt 改为通用描述，移除 "Feishu Bitable" 引用

## 3. 飞书 Adapter 补齐新接口

- [x] 3.1 在 `FeishuBitableAdapter` 中实现 `createIssue` 方法（基于 Bitable `createRecord`，将 `CreateIssueData` 映射为 Bitable 字段）
- [x] 3.2 在 `FeishuBitableAdapter` 中实现 `searchIssues` 方法（基于 Bitable `searchRecords`，用 title 字段模糊匹配）
- [x] 3.3 在 `FeishuBitableAdapter` 中实现 `healthCheck` 方法（验证 auth + bitable 访问权限，返回 `HealthCheckResult[]`）
- [x] 3.4 更新 `FeishuBitableAdapter.getMcpServerConfig` 使用重构后的 `createTrackerTool`

## 4. Registry 扩展与 GitLab 注册修复

- [x] 4.1 在 `src/adapters/tracker/registry.ts` 中定义 `TrackerSetupFn` 类型并扩展 `registerTracker` 签名为 `registerTracker(kind, factory, setupFn?)`，存储 setup 函数
- [x] 4.2 新增 `getTrackerSetup(kind)` 和 `availableTrackerKinds()` 函数（如签名已变更）
- [x] 4.3 修复 `gitlab-issues/register.ts` 中对 `TrackerSetupFn` 的导入，改为从 `../registry.ts` 正确导入
- [x] 4.4 在 `src/cli.ts` 中添加 `await import("./adapters/tracker/gitlab-issues/register.ts")` 注册 GitLab adapter

## 5. 配置体系扩展

- [x] 5.1 在 `src/model/workflow.ts` 的 `trackerConfigSchema` 中添加 GitLab 可选字段：`gitlab_host`、`gitlab_token`、`project_id`、`label_prefix`
- [x] 5.2 重构 `src/workflow/config.ts` 中 `GlobalSettings.tracker` 类型为 `{ [kind: string]: Record<string, unknown> }` 通用结构
- [x] 5.3 更新 `buildServiceConfig` 中 global settings merge 逻辑：按 `tracker.kind` 从 `globals.tracker[kind]` 读取并合并
- [x] 5.4 在 `validateDispatchConfig` 中添加 `gitlab_issues` 分支：校验 `gitlab_host`、`gitlab_token`、`project_id`
- [x] 5.5 在 `buildServiceConfig` 中添加 `gitlab_token` 环境变量解析（`resolveEnvValue`）

## 6. Init 命令多 Tracker 支持

- [x] 6.1 重构 `src/commands/init-core.ts` 的 `stepTracker`：在进入 tracker 配置前，调用 `availableTrackerKinds()` 展示可用 tracker 类型供用户选择
- [x] 6.2 选择 tracker kind 后，调用 `getTrackerSetup(kind)` 获取 setup 函数并执行，获取返回的 config 和 credentials
- [x] 6.3 将飞书 init 逻辑（当前 `stepTracker` 中的飞书部分）封装为符合 `TrackerSetupFn` 签名的函数并在 registry 中注册

## 7. Doctor 命令多 Tracker 支持

- [x] 7.1 重构 `src/commands/doctor.ts`：移除 `checkFeishuAuth` 和 `checkBitableAccess` 硬编码函数及其 Feishu 导入
- [x] 7.2 新增 `checkTrackerHealth` 函数：通过 registry 创建 adapter 实例，调用 `adapter.healthCheck()`（如果存在），报告每个 `HealthCheckResult`
- [x] 7.3 当 adapter 未实现 `healthCheck` 时，显示 "Tracker health check skipped (not supported)" 警告

## 8. Dashboard URL 通用化

- [x] 8.1 在 `FeishuBitableAdapter` 中实现 `getDashboardUrl()` 返回 Bitable URL
- [x] 8.2 在 `GitLabIssuesAdapter` 中实现 `getDashboardUrl()` 返回 project issues URL
- [x] 8.3 更新 `src/cli.ts` dashboard URL 获取：调用 `tracker.getDashboardUrl()` 替代硬编码飞书域名

## 9. 测试

- [x] 9.1 为 `GitLabIssuesAdapter` 编写单元测试（mock GitLab API 响应，覆盖 fetchCandidateIssues、updateIssueState、createIssue、searchIssues、healthCheck）
- [x] 9.2 为通用 `createTrackerTool` 编写单元测试（mock TrackerAdapter 接口，覆盖 5 个 action）
- [x] 9.3 为 `FeishuBitableAdapter` 新增方法编写单元测试（createIssue、searchIssues、healthCheck）
- [x] 9.4 更新或新增 doctor 命令测试（验证 healthCheck 路由和 fallback 行为）
