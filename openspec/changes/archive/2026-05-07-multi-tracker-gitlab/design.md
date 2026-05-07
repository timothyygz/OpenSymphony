## Context

OpenSymphony 当前仅支持飞书多维表格作为 tracker 后端。`TrackerAdapter` 接口本身是 tracker 无关的，但集成层（worker-runner、init、doctor、config、tracker-tools）存在 6 处飞书硬编码。这使得新增 tracker 类型需要改动编排逻辑而非仅实现接口。

GitLab Issues 是最自然的第二种 tracker：REST API 成熟、状态通过 label 管理（与飞书字段映射模式不同）、自托管和 SaaS 均可。

## Goals / Non-Goals

**Goals:**
- 实现 GitLab Issues tracker adapter，完整支持 `TrackerAdapter` 接口
- 将 MCP tool 从飞书专用重构为通用抽象，`getMcpServerConfig` 变为必选
- init / doctor / config 按 tracker `kind` 动态路由，消除硬编码
- 新增第三种 tracker 只需：实现 adapter + register 模块 + init/doctor 的 setup 函数

**Non-Goals:**
- 不改动 `Issue` 域模型（已足够通用）
- 不改动 agent adapter 体系
- 不实现 GitLab Issue 的 MCP tool 高级操作（如 assignee 管理、MR 关联），仅覆盖 create/get/update/list/search
- 不迁移现有飞书用户的配置

## Decisions

### D1: GitLab Issues 状态管理 — Label-based 状态

GitLab Issues 没有原生自定义状态字段（仅有 open/closed）。**使用 scoped label `symphony::状态名` 来映射状态。**

- 候选方案 A：用 open/closed + label → 丢失中间状态（"进行中"无法表达）
- 候选方案 B：用 title 前缀 `[状态]` → 不规范，影响显示
- **选择 Label-based**：用 `symphony::Todo`, `symphony::In Progress` 等 scoped label 表示状态。GitLab scoped label 互斥（同一 prefix 只能有一个），天然适配状态机。

配置映射：`active_states: ["symphony::Todo", "symphony::In Progress"]`，`terminal_states: ["symphony::Done", "symphony::Cancelled"]`。

### D2: GitLab API 认证 — Personal Access Token

使用 GitLab Personal Access Token (PAT) 认证，通过 `PRIVATE-TOKEN` header 传递。

- 候选方案 A：OAuth App → 流程复杂，需要回调 URL，不适合 CLI 场景
- 候选方案 B：Project Access Token → 粒度好但需要 project-level 配置
- **选择 PAT**：最简单，用户在 GitLab Settings → Access Tokens 创建即可。config 中存 `gitlab_token` 和 `gitlab_host`（默认 `https://gitlab.com`）。

### D3: Tracker MCP Tool 抽象 — 基于 TrackerAdapter 的通用操作

将 `tracker-tools.ts` 重构为不绑定任何具体 tracker 的通用实现。

当前：`createBitableTool(api: FeishuBitableApi, issueId)` → 绑定飞书
重构后：`createTrackerTool(adapter: TrackerAdapter, issueId: string)` → 通过 adapter 接口操作

通用 tool 暴露 5 个 action：
- `list` → `fetchCandidateIssues()` / `fetchIssuesByStates()`
- `get` → `fetchIssuesByStates([all])` + 按 id 筛选
- `create` → adapter 新增 `createIssue()` 方法
- `update` → `updateIssueState()` + `updateIssueProgress()` + `updateIssueResultSummary()`
- `search` → adapter 新增 `searchIssues(query)` 方法

为此需要在 `TrackerAdapter` 接口新增 `createIssue` 和 `searchIssues` 两个必选方法。

### D4: Init 路由策略 — 工厂模式

每个 tracker 提供 `setupFunction`，init 流程根据用户选择的 `kind` 调用对应 setup。

```ts
type TrackerSetupFn = (context: SetupContext) => Promise<Record<string, unknown>>;

// registry 扩展
registerTracker(kind, factory, setupFn?);
```

init 流程：选择 kind → 调用 `setupFn` → 返回 config → 写入 WORKFLOW.md。

### D5: Doctor 路由策略 — 接口方法

在 `TrackerAdapter` 新增可选 `healthCheck(): Promise<HealthCheckResult[]>` 方法。doctor 命令调用 `tracker.healthCheck()` 获取结果，不需要 `instanceof` 判断。

## Risks / Trade-offs

- **[Risk] GitLab scoped label 需要手动创建** → 初始化时提供指引，或 GitLab adapter setup 自动创建 labels
- **[Risk] `createIssue` 和 `searchIssues` 是接口变更** → 飞书 adapter 需同步实现这两个方法。飞书的 `createIssue` 可用 Bitable createRecord；`searchIssues` 可用 searchRecords
- **[Risk] MCP tool 的 `create`/`search` 需要适配不同 tracker 的参数模型** → tool 层定义通用参数（title, description, state, query），adapter 负责映射到原生格式
- **[Trade-off] PAT 而非 OAuth** → 牺牲了 token 自动刷新能力，但简化了 CLI 使用。用户需要管理 token 过期
