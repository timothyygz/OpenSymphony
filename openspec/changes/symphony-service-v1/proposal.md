# Symphony Service v1

## Summary

基于 OpenAI Symphony SPEC.md 规范，实现一个编码 Agent 编排服务。核心变体：
- Agent Runner 使用 Claude Code（而非 Codex）
- Issue Tracker 使用飞书多维表格（而非 Linear）
- 技术栈使用 Bun + TypeScript (strict)

## Motivation

OpenAI Symphony 定义了一个清晰的 Agent 编排架构（poll/dispatch/reconcile/retry），但它绑定
了 Codex app-server 和 Linear。我们需要一个类似的服务来编排 Claude Code 处理飞书多维表格
中的任务。

## Scope

### In Scope (v1)
- Workflow Loader：解析 WORKFLOW.md（YAML front matter + prompt body）
- Config Layer：类型化配置 + Zod 校验 + 环境变量解析
- Orchestrator：poll loop / dispatch / reconcile / retry / 并发控制
- Workspace Manager：per-issue 隔离 workspace + hooks
- Agent Runner：Claude Code adapter（子进程模式）
- Tracker：飞书多维表格 adapter
- Logging：结构化 JSON 日志
- 动态配置热加载（WORKFLOW.md 变更自动生效）
- Agent/Tracker 可插拔 adapter 接口

### Out of Scope (v1)
- HTTP Dashboard / REST API（记录为 TODO）
- Codex app-server adapter
- Linear tracker adapter
- OpenCode / Pi agent adapter
- SSH Worker Extension
- `linear_graphql` client-side tool

## Technical Decisions

| 决策 | 选择 | 理由 |
|------|------|------|
| Runtime | Bun | 冷启动 ~30ms，原生 TS 支持 |
| Agent (v1) | Claude Code CLI | 用户指定 |
| Tracker (v1) | 飞书多维表格 | 用户指定 |
| Schema 校验 | Zod | TS 生态标准，运行时 + 编译时类型 |
| 日志 | pino | 结构化 JSON，Bun 兼容 |
| 测试 | vitest | Bun 原生兼容 |
| 模板引擎 | liquidjs | Liquid 兼容，Spec Section 5.4 要求 strict 模式 |
| 状态归一化 | 精确匹配 + trim | 飞书单选字段值是中文，toLowerCase 无效 |
| `blocked_by` | v1 忽略（永远为空） | 飞书多维表格无原生 "blocks" 关系 |
| 项目结构 | 单 repo，不拆 packages | 只有 2 个 adapter，拆包是过早抽象 |

## Risks

1. **Claude Code `--continue` 的 session 隔离性**：`--continue` 是否按 cwd 隔离会话？
   如果不同 workspace 下的 `--continue` 会串 session，需要改用 `--resume <session-id>`。
   **缓解**：T16 实现时首先验证此行为。
2. **Claude Code 没有 app-server 模式**：Codex 的多 turn 驻留 session 无法直接映射到 Claude Code。
   Claude Code `-p` 模式是无状态的，需要通过 `--continue` 实现多轮对话，语义不同。
3. **飞书多维表格 API 延迟**：飞书 REST API 可能比 Linear GraphQL 慢，poll 间隔需要调优。
4. **Bun 兼容性**：部分 Node.js API 在 Bun 中有边缘情况，需要验证子进程管理和文件监听。
