## Why

当前 tracker 体系仅支持飞书多维表格（Feishu Bitable），接口虽抽象但集成层存在大量飞书硬编码。团队需要支持 GitLab Issues 作为第二种 tracker 后端，同时借此机会将抽象改造为真正可扩展的多 tracker 架构——未来新增第三种 tracker 只需实现接口 + 注册模块，无需改动编排或初始化路由代码。

## What Changes

- 新增 GitLab Issues tracker adapter，实现 `TrackerAdapter` 接口，对接 GitLab REST API
- **BREAKING**: `getMcpServerConfig` 从可选方法变为必选方法，所有 tracker 必须为 agent 提供统一的 tracker MCP tool
- 重构 MCP tool 层：从绑定 `FeishuBitableApi` 改为基于 `TrackerAdapter` 接口的通用操作（create/get/update/list/search），agent 感知不到底层 tracker 类型
- 重构 `worker-runner.ts`：移除 `instanceof FeishuBitableAdapter` 检查，改为通过 adapter 接口获取 MCP 配置
- 重构 init 命令：增加 tracker 类型选择步骤，按 `kind` 路由到对应的初始化逻辑
- 重构 `doctor` 命令：tracker 健康检查按 `kind` 分发，不再硬编码飞书
- 重构配置体系：`GlobalSettings.tracker` 改为通用结构，配置校验按 `kind` 动态分发
- 修复 `cli.ts` 中 dashboard URL 的飞书域名硬编码

## Capabilities

### New Capabilities
- `gitlab-tracker`: GitLab Issues tracker adapter 实现，包括 API 对接、状态映射、label-based 状态管理、工厂函数和注册模块
- `tracker-mcp-tool`: 基于 TrackerAdapter 接口的通用 tracker MCP tool，提供 create/get/update/list/search 操作，agent 无需感知底层 tracker 类型

### Modified Capabilities
- `init-wizard`: 增加 tracker 类型选择步骤，按 kind 路由到对应 tracker 的初始化流程
- `doctor`: tracker 相关健康检查按 kind 动态分发，支持 GitLab connectivity 验证
- `tracker-feedback`: MCP tool 变为必选，移除 instanceof 硬编码，统一通过 adapter 接口交互

## Impact

- **核心接口**: `TrackerAdapter` 接口变更（`getMcpServerConfig` 变为必选）
- **新增模块**: `src/adapters/tracker/gitlab-issues/` 目录（adapter, api, auth, register, mapper）
- **重构模块**: `worker-runner.ts`, `tracker-tools.ts`, `cli.ts`, `commands/init.ts`, `commands/doctor.ts`, `workflow/config.ts`
- **配置变更**: `trackerConfigSchema` 需扩展 GitLab 字段，`GlobalSettings` 需重构为通用结构
- **依赖**: 可能需要 `@gitbeaker/rest` 或直接使用 `fetch` 调用 GitLab REST API
- **向后兼容**: 飞书 tracker 现有行为不变，但 `getMcpServerConfig` 必须实现（飞书已有实现）
