## Context

OpenSymphony 是一个 Bun + TypeScript 实现的编码 agent 编排服务。当前架构：
- `Orchestrator` 通过定时 tick 循环执行 poll/dispatch/reconcile/retry
- `OrchestratorState` 持有 running Map、retryAttempts Map、completed Set、aggregateTotals
- `cli.ts` 是纯无头守护进程，Pino JSON 日志写到 stdout
- 零 TUI 或终端渲染依赖

OpenAI Symphony 的 Elixir 版本用 ~60KB 的 `status_dashboard.ex` 实现了一个自定义 ANSI 仪表盘，作为主要可观测性界面。我们做类似的事，但适配 Claude Code 的事件体系和 TypeScript/Bun 环境。

## Goals / Non-Goals

**Goals:**
- 实时终端仪表盘，每秒刷新 orchestrator 状态
- Alternate screen buffer，退出后终端历史完整保留
- 零新依赖，纯 ANSI 转义码渲染
- `--no-tui` 标志保留 headless 模式
- CJK 字符宽度正确处理
- 保留后续键盘交互的扩展性

**Non-Goals:**
- V1 不实现键盘交互（q/r/方向键等），留给 V2
- 不实现 HTTP dashboard 或 REST API
- 不实现多面板布局或滚动列表
- 不支持 Windows 终端（ANSI 转义码兼容性）
- 不实现日志文件写入（日志只走 stdout/stderr）

## Decisions

### D1: 自定义 ANSI 而非 TUI 框架

**选择**: 手写 ANSI 转义码
**替代方案**: ink（React for CLI）、blessed、terminal-kit
**理由**: 与 Elixir 版本一致，零依赖，完全控制。Bun 的 `process.stdout.write` 直接支持 ANSI。TUI 框架引入 50+ 依赖和 Bun 兼容性风险。

### D2: Alternate screen buffer 而非原地覆盖

**选择**: `\x1b[?1049h` / `\x1b[?1049l`
**替代方案**: `\x1b[H` + `\x1b[2J`（home + clear，Elixir 的方式）
**理由**: 原地覆盖会丢失终端历史。Alternate screen 是 Vim、htop 等工具的标准做法，用户预期这种行为。

### D3: Logger Proxy 懒加载重定向

**选择**: `logger.ts` 导出 Proxy 包装的懒初始化 logger，首次调用时才读取 `SYMPHONY_LOG_DEST` 环境变量
**替代方案**: (A) 全量 dynamic import 重构 cli.ts、(B) Pino transport、(C) monkey-patch stdout
**理由**: ESM 静态 import 在任何运行时代码之前执行，无法通过在 cli.ts 中赋值 env var 来控制 logger 初始化。Proxy 方案让所有现有 `import { logger }` 无需改动，只在首次调用 `logger.info()` 时才创建 pino 实例，此时 env var 已就绪。避免了将 cli.ts 所有静态 import 改为 dynamic import 的大范围重构。

### D4: 去掉 PID 列，换成 Issue Title 列

**选择**: ID / TITLE / STATE / AGE-AND-TURN / TOKENS / EVENT
**替代方案**: 照搬 Elixir 的 ID / STAGE / PID / AGE / TOKENS / SESSION / EVENT
**理由**: Claude Code 每次 turn 是独立 `Bun.spawn` 进程，无常驻 PID 概念。`codexAppServerPid` 字段存在但从未被 Claude Code adapter 填充。Issue title 对运维更有价值。

### D5: 字段拼接指纹而非 JSON.stringify

**选择**: 拼接关键字段（running identifiers + events + token totals + retry ids + completed count）为字符串
**替代方案**: `JSON.stringify(state)` + hash
**理由**: `JSON.stringify` 对 Map/Set 序列化结果为 `{}`/`[]`，无法检测变化。字段拼接直接比较字符串即可，不需要加密 hash。

### D6: Polling 而非 Event-driven

**选择**: `setInterval(() => orchestrator.getState(), 1000)`
**替代方案**: Orchestrator 继承 EventEmitter，TUI 订阅 state change 事件
**理由**: V1 只需要最终一致的状态快照，不需要实时事件流。1 秒 polling 对仪表盘足够。Event-driven 需要改 Orchestrator 接口，增加耦合。后续如果需要实时日志流，再加 EventEmitter。

### D7: Claude Code 事件映射表

**选择**: 静态映射表 `EVENT_LABELS`，fallback 到原始事件名
**替代方案**: 像 Elixir 那样用 ~400 行做深度解析
**理由**: Claude Code 的 `stream-json` 事件模型比 Codex 简单得多（system/assistant/content_block_*/result/tool_use/tool_result），50 行映射表足够。

## Risks / Trade-offs

**[Bun alternate screen 兼容性]** → 部分终端模拟器可能不支持 `\x1b[?1049h`。缓解：检测 `process.stdout.isTTY`，非 TTY 环境自动降级为 `--no-tui` 模式。

**[Dynamic import 时序]** → 已通过 Logger Proxy 懒加载方案解决（D3）。所有现有 `import { logger }` 无需改动。

**[nextTickAt 过期]** → tick 执行期间 `nextTickAt` 指向过去的时间戳，倒计时会显示负数。缓解：Dashboard 在 `nextTickAt < Date.now()` 时显示 "refreshing..." 而非倒计时。

**[CJK 宽度检测不完美]** → Unicode 有大量边界情况（emoji、组合字符）。缓解：只处理 CJK 基本区间，emoji 和组合字符按宽度 1 处理。issue title 截断有 `...` fallback，不会破坏布局。

**[终端高度溢出]** → 10+ running agents 可能超出 24 行终端高度。缓解：V1 允许溢出（同 Elixir），V2 加 viewport 滚动。
