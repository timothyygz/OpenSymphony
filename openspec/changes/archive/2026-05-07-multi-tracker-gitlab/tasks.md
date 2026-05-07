## 1. TrackerAdapter 接口扩展

- [x] 1.1 在 `TrackerAdapter` 接口中将 `getMcpServerConfig` 从可选改为必选方法
- [x] 1.2 在 `TrackerAdapter` 接口中新增必选方法 `createIssue(data: CreateIssueData): Promise<Issue>`
- [x] 1.3 在 `TrackerAdapter` 接口中新增必选方法 `searchIssues(query: string): Promise<Issue[]>`
- [x] 1.4 在 `TrackerAdapter` 接口中新增可选方法 `healthCheck(): Promise<HealthCheckResult[]>`
- [x] 1.5 定义 `CreateIssueData`、`HealthCheckResult` 类型到 `src/adapters/tracker/types.ts`

## 2. 通用 Tracker MCP Tool 重构

- [x] 2.1 重构 `tracker-tools.ts`：将 `createBitableTool(api, issueId)` 改为 `createTrackerTool(adapter: TrackerAdapter, issueId: string)`，基于 adapter 接口实现 list/get/create/update/search 五个 action
- [x] 2.2 更新 `createTrackerMcpServer` 函数签名，接受 `TrackerAdapter` 而非 `FeishuBitableApi`
- [x] 2.3 更新 `worker-runner.ts`：移除 `instanceof FeishuBitableAdapter` 检查，改为通过 `tracker.getMcpServerConfig(issueId)` 获取 MCP 配置
- [x] 2.4 将 tracker guidance prompt 改为通用描述，不提及 "Feishu Bitable"

## 3. 飞书 Adapter 补齐新接口

- [x] 3.1 在 `FeishuBitableAdapter` 中实现 `createIssue` 方法（基于 Bitable createRecord）
- [x] 3.2 在 `FeishuBitableAdapter` 中实现 `searchIssues` 方法（基于 Bitable searchRecords）
- [x] 3.3 在 `FeishuBitableAdapter` 中实现 `healthCheck` 方法（验证 auth + bitable 访问权限）
- [x] 3.4 在 `FeishuBitableAdapter` 中实现 `getMcpServerConfig`，使用通用 `createTrackerTool`

## 4. GitLab Issues Tracker Adapter 实现

- [x] 4.1 创建 `src/adapters/tracker/gitlab-issues/` 目录结构
- [x] 4.2 实现 `api.ts`：GitLab REST API 封装（GET/POST/PUT issues，PRIVATE-TOKEN 认证）
- [x] 4.3 实现 `mapper.ts`：GitLab Issue response → `Issue` 域模型映射（含 label-based 状态提取）
- [x] 4.4 实现 `adapter.ts`：`GitLabIssuesAdapter` 类，完整实现 `TrackerAdapter` 接口（含 scoped label 状态管理）
- [x] 4.5 实现 `register.ts`：注册 `gitlab_issues` kind + setup 函数
- [x] 4.6 在 `cli.ts` 和 `bootstrap.ts` 中导入 `gitlab-issues/register.ts` 触发注册

## 5. 配置体系重构

- [x] 5.1 重构 `GlobalSettings.tracker`：从 `{ feishu: {...} }` 改为通用结构 `{ [kind]: {...} }`
- [x] 5.2 扩展 `trackerConfigSchema` 添加 GitLab 字段（`gitlab_host`, `gitlab_token`, `project_id`）
- [x] 5.3 重构 `workflow/config.ts` 中的验证逻辑：按 `kind` 动态分发验证，移除硬编码 `feishu_bitable` 判断
- [x] 5.4 修复 `cli.ts` 中 dashboard URL 的飞书域名硬编码，改为通过 adapter 获取或按 kind 分发

## 6. Init 命令多 Tracker 支持

- [x] 6.1 在 tracker registry 中扩展注册接口，支持附带 setup 函数：`registerTracker(kind, factory, setupFn?)`
- [x] 6.2 重构 `commands/init-core.ts`：增加 tracker 类型选择步骤，调用对应 setup 函数
- [x] 6.3 实现 GitLab init setup 函数：收集 gitlab_host/token/project_id，测试连接，创建 scoped labels
- [x] 6.4 将飞书 init 逻辑封装为 setup 函数并注册

## 7. Doctor 命令多 Tracker 支持

- [x] 7.1 重构 `commands/doctor.ts`：移除硬编码的 `checkFeishuAuth` 和 `checkBitableAccess`，改为调用 `adapter.healthCheck()`（如果实现了）
- [x] 7.2 当 adapter 未实现 `healthCheck` 时，显示警告跳过

## 8. 测试

- [x] 8.1 为 `GitLabIssuesAdapter` 编写单元测试（mock GitLab API 响应）
- [x] 8.2 为通用 `createTrackerTool` 编写单元测试（mock TrackerAdapter）
- [x] 8.3 更新现有飞书 adapter 测试，覆盖新增的 `createIssue`、`searchIssues`、`healthCheck` 方法
- [x] 8.4 更新 `cli-commands.test.ts` 中的相关测试用例
