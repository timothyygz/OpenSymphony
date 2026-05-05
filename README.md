# OpenSymphony

基于 [OpenAI Symphony SPEC](https://github.com/openai/symphony/blob/main/SPEC.md) 的编码 Agent 编排服务。使用 Claude Code 作为执行引擎，飞书多维表格（或 Linear）作为任务追踪器。

## 快速开始

### 前置条件

- [Bun](https://bun.sh/) >= 1.x
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) 已安装并登录

### 安装

```bash
git clone https://github.com/timothyygz/OpenSymphony.git
cd OpenSymphony
bun install
```

### 配置

1. 复制示例配置并填写凭据：

```bash
cp WORKFLOW.md.example WORKFLOW.md
```

2. 编辑 `WORKFLOW.md`，至少需要填写飞书应用凭据和多维表格信息（见 [配置参考](#配置参考)）。

凭据也可以通过以下方式提供（优先级从高到低）：

- `WORKFLOW.md` 中直接填写
- 环境变量 `$FEISHU_APP_ID` / `$FEISHU_APP_SECRET`（在配置中写 `$FEISHU_APP_ID`）
- 全局配置文件 `~/.open-symphony/settings.json`：

```json
{
  "tracker": {
    "feishu": {
      "app_id": "cli_xxxxx",
      "app_secret": "xxxxx",
      "app_token": "bascnXXXXXX",
      "table_id": "tblXXXXXX"
    }
  }
}
```

### 启动

```bash
bun run start
```

默认以 TUI 仪表盘模式运行。在无终端环境下自动切换为 headless 模式（JSON 日志输出到 stdout）。

### CLI 用法

```
symphony [选项] [WORKFLOW.md 路径]

选项：
  --no-tui    以 headless 模式运行（JSON 日志输出到 stdout）
  -h, --help  显示帮助信息
```

若未指定配置文件路径，默认使用当前目录下的 `WORKFLOW.md`。

## 架构概览

```
WORKFLOW.md ──▶ Workflow Loader ──▶ Config
                                        │
                   ┌────────────────────┤
                   ▼                    ▼
             TrackerAdapter       AgentAdapter
             (飞书多维表格/Linear)  (Claude Code)
                   │                    │
                   ▼                    ▼
             Bitable/Linear API    claude -p CLI
```

核心组件：

| 组件 | 职责 |
|------|------|
| **Orchestrator** | 主循环：轮询 → 调度 → 执行 → 协调 → 重试 |
| **Agent Adapter** | 可插拔执行引擎，默认 Claude Code |
| **Tracker Adapter** | 可插拔任务源，支持飞书多维表格、Linear |
| **Workspace Manager** | 每个任务独立工作目录 + 生命周期 hooks |
| **Workflow Loader** | 解析 `WORKFLOW.md`（YAML front matter + Liquid 模板） |

## 配置参考

所有配置通过 `WORKFLOW.md` 的 YAML front matter 定义。文件结构如下：

```markdown
---
(YAML 配置)
---
(Liquid 模板，作为每个任务的 prompt)
```

### tracker（必填）

任务追踪器配置。支持 `feishu_bitable` 和 `linear` 两种类型。

#### 飞书多维表格（feishu_bitable）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `kind` | `string` | 是 | 固定值 `"feishu_bitable"` |
| `app_id` | `string` | 是 | 飞书应用 ID，支持 `$VAR` 环境变量间接引用 |
| `app_secret` | `string` | 是 | 飞书应用密钥，支持 `$VAR` 环境变量间接引用 |
| `app_token` | `string` | 是 | 多维表格 app token |
| `table_id` | `string` | 是 | 多维表格 table ID |
| `state_field` | `string` | 是 | 状态字段名 |
| `identifier_field` | `string` | 是 | 编号字段名 |
| `title_field` | `string` | 是 | 标题字段名 |
| `description_field` | `string` | 否 | 描述字段名，默认 `"描述"` |
| `priority_field` | `string` | 否 | 优先级字段名 |
| `labels_field` | `string` | 否 | 标签字段名 |
| `tokens_field` | `string` | 否 | Token 用量追踪字段名 |
| `join_command_field` | `string` | 否 | Join 命令字段名 |
| `progress_field` | `string` | 否 | 进度字段名 |
| `result_summary_field` | `string` | 否 | 结果摘要字段名 |
| `endpoint` | `string` | 否 | API 端点覆盖 |
| `active_states` | `string[]` | 否 | 可调度的状态列表，默认 `["Todo", "In Progress"]` |
| `terminal_states` | `string[]` | 否 | 终态列表，默认 `["Closed", "Cancelled", "Canceled", "Duplicate", "Done"]` |

#### Linear

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `kind` | `string` | 是 | 固定值 `"linear"` |
| `api_key` | `string` | 是 | Linear API Key，支持 `$VAR` 环境变量间接引用 |
| `project_slug` | `string` | 是 | Linear 项目 slug |
| `active_states` | `string[]` | 否 | 同上 |
| `terminal_states` | `string[]` | 否 | 同上 |

### polling

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `interval_ms` | `number` | `30000` | 轮询间隔（毫秒） |

### workspace

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `root` | `string` | `${tmpdir}/symphony_workspaces` | 工作空间根目录，支持 `~` 展开 |
| `sources` | `WorkspaceSource[]` | `[]` | 工作空间来源定义 |
| `cleanup_on_terminal` | `boolean` | `false` | 任务终态时是否清理工作目录 |

#### WorkspaceSource

支持两种类型：

**git-clone：**

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `type` | `"git-clone"` | 是 | — | 来源类型 |
| `url` | `string` | 是 | — | Git 仓库地址 |
| `path` | `string` | 是 | — | 工作空间内的目标路径 |
| `branch` | `string` | 否 | — | 分支名 |
| `depth` | `number` | 否 | `1` | 浅克隆深度 |

**git-worktree：**

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `type` | `"git-worktree"` | 是 | — | 来源类型 |
| `repo` | `string` | 是 | — | 本地 Git 仓库路径 |
| `path` | `string` | 否 | — | 目标路径 |
| `branch` | `string` | 否 | — | 分支名 |

### hooks

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `after_create` | `string` | — | 工作目录创建后执行的 shell 命令 |
| `before_run` | `string` | — | Agent 执行前执行的 shell 命令 |
| `after_run` | `string` | — | Agent 执行后执行的 shell 命令（best-effort） |
| `before_remove` | `string` | — | 工作目录删除前执行的 shell 命令（best-effort） |
| `timeout_ms` | `number` | `60000` | Hook 执行超时（毫秒） |

### agent

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `kind` | `string` | `"claude-code"` | Agent 适配器类型 |
| `max_concurrent_agents` | `number` | `10` | 最大并发 Agent 数 |
| `max_concurrent_agents_by_state` | `Record<string, number>` | `{}` | 按状态限制并发（key=状态名, value=最大数） |
| `max_turns` | `number` | `20` | 单任务最大轮数 |
| `max_retry_backoff_ms` | `number` | `300000` | 重试最大退避延迟（毫秒） |
| `max_retry_attempts` | `number` | `3` | 最大重试次数 |
| `stall_timeout_ms` | `number` | `300000` | Agent 卡死判定超时（毫秒） |
| `in_progress_state` | `string` | `"进行中"` | 进行中的状态名 |
| `active_reset_state` | `string` | `"待处理"` | 失败重试时重置的状态名 |
| `permanent_failure_state` | `string` | `"永久失败"` | 超过最大重试次数后的终态名 |
| `config` | `object` | `{}` | 传递给 Agent 适配器的配置 |

#### Claude Code 适配器配置（agent.config）

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `command` | `string` | `"claude"` | Claude Code 可执行文件路径 |
| `timeout_ms` | `number` | `3600000` | 单轮执行超时（毫秒，默认 1 小时） |
| `approval_policy` | `string` | — | 设为 `"auto"` 跳过权限确认 |

### server

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `port` | `number` | — | HTTP 服务端口（可选） |

### 环境变量

| 变量 | 说明 |
|------|------|
| `SYMPHONY_SETTINGS_PATH` | 全局配置文件路径，默认 `~/.open-symphony/settings.json` |
| `SYMPHONY_LOG_DEST` | 日志输出目标，设为 `"stderr"` 输出到 stderr |
| `LOG_LEVEL` | 日志级别：`trace` / `debug` / `info` / `warn` / `error` / `fatal`，默认 `info` |
| `SYMPHONY_TUI_REFRESH_MS` | TUI 刷新间隔（毫秒），默认 `1000` |
| `TERM` | 设为 `"dumb"` 时禁用 TUI |

## Prompt 模板

WORKFLOW.md 中 `---` 之后的正文为 Liquid 模板，每个任务渲染一次。可用变量：

```liquid
You are working on {{ issue.identifier }}: {{ issue.title }}
{{ issue.description }}

{% if attempt %}
This is retry attempt #{{ attempt }}.
{% endif %}
```

| 变量 | 说明 |
|------|------|
| `issue.identifier` | 任务编号 |
| `issue.title` | 任务标题 |
| `issue.description` | 任务描述 |
| `issue.state` | 当前状态 |
| `issue.priority` | 优先级 |
| `issue.labels` | 标签（数组，可用 `{{ issue.labels \| join: ", " }}`） |
| `attempt` | 重试次数（首次为空） |

## 完整配置示例

```yaml
---
tracker:
  kind: feishu_bitable
  app_id: "$FEISHU_APP_ID"
  app_secret: "$FEISHU_APP_SECRET"
  app_token: "bascnXXXXXX"
  table_id: "tblXXXXXX"
  state_field: "状态"
  identifier_field: "编号"
  title_field: "标题"
  description_field: "描述"
  priority_field: "优先级"
  labels_field: "标签"
  active_states: ["待处理"]
  terminal_states: ["已完成", "已取消", "已关闭"]

polling:
  interval_ms: 30000

workspace:
  root: "~/.open-symphony/workspaces"
  cleanup_on_terminal: true
  sources:
    - type: git-worktree
      repo: ~/Workspace/my-project
      path: repo

hooks:
  after_create: |
    echo "Workspace created for issue"
  before_run: |
    echo "Starting work on issue"

agent:
  kind: claude-code
  max_concurrent_agents: 5
  max_concurrent_agents_by_state:
    "待处理": 3
  max_turns: 20
  max_retry_backoff_ms: 300000
  max_retry_attempts: 3
  in_progress_state: "进行中"
  active_reset_state: "待处理"
  permanent_failure_state: "永久失败"
  config:
    command: claude
    timeout_ms: 3600000
    approval_policy: auto
---
You are an AI coding assistant working on issue {{ issue.identifier }}: {{ issue.title }}.

## Issue Description
{{ issue.description }}

## Instructions
1. Read the issue description carefully.
2. Implement the required changes.
3. Write tests for your changes.
4. Ensure all existing tests pass.
```

## 运行机制

### 任务生命周期

```
待处理 ──(dispatch)──▶ 进行中 ──(完成)──▶ 已完成
                          │
                          └──(失败)──▶ 待处理（重新调度）
                          └──(超次)──▶ 永久失败
```

1. **轮询**：定时从追踪器拉取 `active_states` 状态的任务
2. **调度**：按优先级和创建时间排序，受 `max_concurrent_agents` 和 `max_concurrent_agents_by_state` 约束
3. **执行**：每个任务在独立工作目录中启动 Claude Code 会话
4. **重试**：正常退出但任务未完成时立即续跑；异常退出按指数退避重试
5. **协调**：检测卡死的 Agent（超过 `stall_timeout_ms`）并终止；同步追踪器状态，终态任务自动清理

### 配置热加载

修改 `WORKFLOW.md` 后自动生效（1 秒轮询 + 300ms 防抖），无需重启服务。解析失败时保留上一次有效配置。

## 扩展

添加新的 Agent 或 Tracker 适配器：

1. 在 `src/adapters/` 下创建新目录
2. 实现 `AgentAdapter` 或 `TrackerAdapter` 接口
3. 创建 `register.ts` 调用 `registerAgent()` / `registerTracker()`
4. 在 `cli.ts` 中导入 register 文件

参考 `examples/json-tracker/` 了解 Tracker 适配器的完整实现。

## 测试

```bash
bun test           # 单次运行
bun run test:watch  # 监听模式
```

## 技术栈

Bun · TypeScript (strict) · Zod · Pino · LiquidJS

## License

MIT
