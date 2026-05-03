# OpenSymphony

基于 [OpenAI Symphony SPEC](https://github.com/openai/symphony/blob/main/SPEC.md) 的编码 Agent 编排服务，使用 Claude Code 替代 Codex，飞书多维表格替代 Linear。

## 架构

```
WORKFLOW.md ──▶ Workflow Loader ──▶ Config ──▶ Orchestrator
                                               │
                              ┌────────────────┤
                              ▼                ▼
                        TrackerAdapter   AgentAdapter
                        (飞书多维表格)    (Claude Code)
                              │                │
                              ▼                ▼
                         Bitable API     claude -p CLI
```

核心组件：
- **Orchestrator** — poll/dispatch/reconcile/retry 主循环
- **Agent Adapter** — 可插拔，v1 实现 Claude Code（`claude -p --output-format stream-json`）
- **Tracker Adapter** — 可插拔，v1 实现飞书多维表格（Bitable REST API）
- **Workspace Manager** — per-issue 隔离工作目录 + 生命周期 hooks
- **Workflow Loader** — 解析 `WORKFLOW.md`（YAML front matter + Liquid 模板）

## 快速开始

```bash
bun install

# 编辑 WORKFLOW.md 中的 app_id、app_secret、app_token、table_id
# 启动服务
bun run start
```

## 功能列表

### 1. 任务发现与调度

- 定时轮询飞书多维表格，发现状态为"待处理"的任务
- 按优先级升序、创建时间升序排序后依次调度
- 全局并发控制（`max_concurrent_agents`）
- 按状态并发控制（`max_concurrent_agents_by_state`）

### 2. 分布式锁（状态流转）

通过飞书多维表格的状态字段实现分布式锁，避免多实例重复处理：

```
待处理 ──(dispatch)──▶ 进行中 ──(完成)──▶ 已完成
                          │
                          └──(失败)──▶ 待处理（重新调度）
```

- 只拉取"待处理"的任务
- 分发时立即改为"进行中"（其他实例不会重复拉取）
- 正常完成后改为"已完成"
- 失败后重置为"待处理"，由重试机制重新调度

### 3. Agent 执行

每个任务在独立工作目录中启动 Claude Code 会话：
- 第一轮：`claude -p <prompt>`（携带 issue 上下文）
- 后续轮：`claude --continue -p <prompt>`（延续对话）
- 输出格式：`stream-json`（结构化事件流）
- 支持配置 `approval_policy: auto`（跳过权限确认）
- 单任务最大轮数控制（`max_turns`）

### 4. 重试与容错

- **正常退出 → 续跑重试**（1s 延迟）：Agent 正常结束但任务仍为活跃状态时，自动发起下一轮
- **异常退出 → 指数退避重试**：失败后按 `10s × 2^(attempt-1)` 递增延迟，上限 `max_retry_backoff_ms`
- 失败时自动重置任务状态为"待处理"，确保重试能重新调度

### 5. 状态协调（Reconcile）

每个 tick 周期中：
- **卡死检测**：超过 `stall_timeout_ms` 无活动的 worker 自动终止并重试
- **追踪器状态同步**：检查运行中任务的最新状态，若已变为终态则终止 worker 并清理工作目录

### 6. 配置热加载

修改 `WORKFLOW.md` 后自动生效，无需重启服务：
- `WorkflowWatcher` 每秒检测文件变更（300ms 防抖）
- 解析成功后调用 `orchestrator.updateConfig()` 更新运行参数
- 解析失败时保留上一次有效配置，服务不中断

### 7. 工作空间管理

- 每个任务创建独立目录（`{root}/{identifier}/`）
- 重试时复用已有工作目录（保留之前的工作成果）
- 启动时自动清理已终态任务的工作目录
- 路径安全校验（防止目录遍历）

### 8. 生命周期 Hooks

在 `WORKFLOW.md` 中配置 shell 脚本，在关键节点执行：

| Hook | 触发时机 |
|------|---------|
| `after_create` | 工作目录创建后 |
| `before_run` | Agent 执行前 |
| `after_run` | Agent 执行后（best-effort） |
| `before_remove` | 工作目录删除前（best-effort） |

### 9. Prompt 模板

使用 Liquid 模板语法，支持变量：

```liquid
You are working on {{ issue.identifier }}: {{ issue.title }}
{{ issue.description }}

{% if attempt %}
This is retry attempt #{{ attempt }}.
{% endif %}
```

### 10. Token 用量追踪

- 实时追踪每个任务的 input/output/total token 用量
- 通过 delta 差量计算避免重复计数
- 记录 API rate limit 信息

### 11. 结构化日志

基于 Pino 的 JSON 结构化日志，包含 issue ID、workspace、耗时等上下文。

## 配置

通过 `WORKFLOW.md` 配置所有行为：

```yaml
---
tracker:
  kind: feishu_bitable
  app_id: "cli_xxxxx"
  app_secret: "xxxxx"
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
  root: "/tmp/symphony_workspaces"

hooks:
  after_create: |
    echo "Workspace created for issue"
  before_run: |
    echo "Starting work on issue"

agent:
  max_concurrent_agents: 5
  max_turns: 20
  max_retry_backoff_ms: 300000

claude_code:
  command: claude
  timeout_ms: 3600000
  approval_policy: auto
---
You are working on {{ issue.identifier }}: {{ issue.title }}
{{ issue.description }}
```

## 项目结构

```
src/
├── cli.ts                          # 入口
├── orchestrator/
│   ├── orchestrator.ts             # 主循环
│   ├── state.ts                    # 运行时状态
│   ├── dispatch.ts                 # 调度排序 + 并发控制
│   └── retry.ts                    # 指数退避重试
├── workflow/
│   ├── loader.ts                   # WORKFLOW.md 解析
│   ├── config.ts                   # Zod schema + $VAR 解析
│   ├── watcher.ts                  # 文件监听 + 热加载
│   └── prompt.ts                   # Liquid 模板渲染
├── workspace/
│   ├── manager.ts                  # 创建/复用/清理
│   ├── hooks.ts                    # shell hooks
│   └── safety.ts                   # 路径安全校验
├── adapters/
│   ├── agent/claude-code/          # Claude Code adapter
│   └── tracker/feishu-bitable/     # 飞书多维表格 adapter
├── model/                          # 类型定义 + Zod schema
├── errors/                         # 类型化错误
└── logging/                        # pino 结构化日志
```

## 测试

```bash
bun test
```

## 扩展

添加新的 Agent 或 Tracker adapter：

1. 在 `src/adapters/` 下创建新目录
2. 实现 `AgentAdapter` 或 `TrackerAdapter` 接口
3. 创建 `register.ts` 调用 `registerAgent()` / `registerTracker()`
4. 在 `cli.ts` 中导入 register 文件

## 技术栈

Bun / TypeScript (strict) / Zod / Pino / LiquidJS

## License

MIT
