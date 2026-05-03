## Why

OpenSymphony 当前是无头守护进程，仅通过 Pino JSON 日志输出到 stdout。运维人员无法直观地观察 agent 运行状态、token 消耗、重试队列和吞吐量。OpenAI Symphony 的 Elixir 参考实现包含一个自定义 ANSI 终端仪表盘作为主要可观测性界面，我们应当提供类似体验。

## What Changes

- 新增 TUI 仪表盘模块（`src/tui/`），使用自定义 ANSI 转义码渲染实时状态面板
- 渲染内容包括：agent 概览（数量/已完成）、吞吐量迷你图、token 用量、速率限制、运行中 agent 表格、退避队列
- 使用 alternate screen buffer，退出后恢复终端历史
- TUI 模式下 Pino 日志重定向到 stderr，避免污染仪表盘
- CLI 新增 `--no-tui` 标志，保留原有 headless 模式
- OrchestratorState 新增 `nextTickAt` 字段，支持 "下次刷新" 倒计时显示
- Running table 不显示 PID（Claude Code 无常驻进程概念），改为显示 Issue 标题
- 处理 CJK 字符宽度，确保中文状态值列对齐

## Capabilities

### New Capabilities
- `tui-dashboard`: 自定义 ANSI 终端仪表盘，实时渲染 orchestrator 状态（header 概览、running agent 表格、backoff 队列、吞吐量迷你图）
- `tui-integration`: CLI 集成层，包括 `--no-tui` 参数、日志重定向、Dashboard 与 Orchestrator 的生命周期绑定

### Modified Capabilities
<!-- 无现有 spec 需要修改 -->

## Impact

- **新增代码**: `src/tui/` 目录下 6 个新文件（~660 行）
- **修改文件**: `src/orchestrator/state.ts`（+1 字段）、`src/orchestrator/orchestrator.ts`（+1 行）、`src/logging/logger.ts`（+3 行）、`src/cli.ts`（重构为 dynamic import + Dashboard 启动）
- **零新依赖**: 纯 ANSI 转义码，不引入第三方 TUI 库
- **API 无变化**: Orchestrator 和 adapter 接口不变，仅新增 `nextTickAt` state 字段
