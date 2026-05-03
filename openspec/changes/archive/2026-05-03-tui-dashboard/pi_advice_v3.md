# TUI Dashboard 计划审查意见

## 整体评价

计划整体质量很高：提案、设计、规格说明和任务分解都很详细合理；D1-D7 每个关键决策都有替代方案和理由；风险识别到位；零依赖策略与 Elixir 版本一致。以下列出发现的问题和改进建议。

---

## 问题

### P1: Dynamic Import 范围被低估（最关键）

Task 6.2 说"修改 `cli.ts` — 使用 dynamic import"，但当前 `cli.ts` 顶部有：

```ts
import { logger } from "./logging/logger.ts";
import "./adapters/tracker/feishu-bitable/register.ts";  // → adapter.ts → logger
import "./adapters/agent/claude-code/register.ts";        // → adapter.ts → logger → process.ts → logger
```

ESM 静态导入在**任何运行时代码之前**执行。所以 `process.env.SYMPHONY_LOG_DEST = "stderr"` 永远会在 logger 初始化**之后**才执行。要真正解决这个问题，`cli.ts` 里的**所有这些静态导入**都必须改为 `await import(...)`：

```ts
async function main() {
  const { noTui } = parseArgs(process.argv.slice(2));
  if (!noTui && process.stdout.isTTY) {
    process.env.SYMPHONY_LOG_DEST = "stderr";
  }
  const { Orchestrator } = await import("./orchestrator/orchestrator.ts");
  const { logger } = await import("./logging/logger.ts");
  // ... 其余模块
}
```

这意味着 `main()` 之前的**所有**顶层静态导入都要移除，包括 `Orchestrator`、`WorkflowWatcher`、`WorkspaceManager`、两个 adapter register 等。这是一个比描述中更大的重构。

**替代方案（推荐）：** 将 logger 改为懒初始化，避免全量 dynamic import 重构：

```ts
// logger.ts
let _logger: pino.Logger | null = null;

function getLogger(): pino.Logger {
  if (!_logger) {
    _logger = pino(
      { level: process.env.LOG_LEVEL ?? "info", formatters: { level: (label) => ({ level: label }) } },
      process.env.SYMPHONY_LOG_DEST === "stderr" ? pino.destination(2) : undefined,
    );
  }
  return _logger;
}

// Proxy 让所有 import { logger } 的现有代码无需修改
export const logger: pino.Logger = new Proxy({} as pino.Logger, {
  get(_, prop) {
    return Reflect.get(getLogger(), prop);
  },
});
```

这样 static import 不会触发 pino 创建，只有第一次调用 `logger.info()` 等方法时才检查 env var。所有现有 `import { logger }` 不需要改动。

### P2: `nextTickAt` 在 tick 执行期间会过期

当前 `scheduleTick()` 的流程：

1. `scheduleTick()` → 设置 `nextTickAt = now + 30s`，注册 30s 后的 setTimeout
2. 30s 后 timeout 触发，`tick()` 开始执行（可能持续数秒到数十秒）
3. 在 tick 执行期间，`nextTickAt` 指向过去的时间戳
4. tick 完成后再次调用 `scheduleTick()`，`nextTickAt` 才被更新

Dashboard 在步骤 3 中会显示 "Next refresh: -5s" 或 "Next refresh: 0s"，令人困惑。

**建议：** 在 Dashboard 的 `formatHeader()` 中增加判断——如果 `nextTickAt` 非 null 但小于 `Date.now()`，显示 `"refreshing..."` 而非负数倒计时。或者在 `tick()` 开始时将 `nextTickAt` 设为 `null`，tick 结束后再设为新值。

### P3: `rateLimits` 类型是 `unknown`

`OrchestratorState.rateLimits: unknown` — 计划说 header 要显示 "Rate Limits"，但没有定义具体格式。`event.rateLimits` 来自 Claude Code 的 `stream-json` 输出，其结构未在计划中描述。

**建议：** 在 `events.ts` 或新建 `types.ts` 中定义 `RateLimitInfo` 接口（至少包含 `remaining` / `limit` / `resetAt` 等常见字段），在 Dashboard 中做 defensive formatting——遇到 `unknown` 或结构不符时显示 `"N/A"`。

### P4: SIGWINCH 没有明确的 Task

Spec 中明确要求 "SHALL handle SIGWINCH (resize) events"，但 tasks.md 中没有一个 task 明确提到 resize 监听。Task 3.2 提到 "dynamic EVENT column width" 但没有说如何检测宽度变化。

**建议：** 在 Task 4.1（Dashboard 类）中增加子项："在 `start()` 中监听 `process.stdout.on('resize', callback)` 触发强制 re-render；在 `stop()` 中移除监听器"。注意：Bun/Node.js 的 stdout 会发出 `'resize'` 事件，不需要手动监听 SIGWINCH signal。

### P5: Sparkline 数据来源不够明确

Task 2.2 说 "滚动 TPS 计算（5s 窗口）"、"sparkline 图表（10 分钟窗口）"。但 `OrchestratorState.aggregateTotals` 只有**累积** token 数，没有 per-second 数据。Sparkline 模块需要自己维护时间序列，这个关键设计隐含在实现中但没有被记录。

**建议：** 在 Task 2.2 的描述中明确：`Sparkline` 类内部维护一个环形缓冲区（ring buffer），每秒从 `state.aggregateTotals.totalTokens` 采样并计算差值作为 TPS。窗口为 10 分钟 × 60 秒 = 600 个采样点，取 24 个 bucket 做降采样后映射到 `▁▂▃▄▅▆▇█`。

### P6: `--no-tui` 参数解析可能与其他参数冲突

当前 `parseArgs` 只接受一个位置参数（workflow 路径）。加 `--no-tui` 后需要同时支持：

- `bun run src/cli.ts --no-tui path/to/WORKFLOW.md`
- `bun run src/cli.ts path/to/WORKFLOW.md --no-tui`
- `bun run src/cli.ts --no-tui`

**建议：** Task 6.2 中明确新的 `parseArgs` 支持 flag 和位置参数混合解析：

```ts
function parseArgs(args: string[]): { workflowPath?: string; noTui: boolean } {
  const noTui = args.includes("--no-tui");
  const positional = args.filter((a) => !a.startsWith("-"));
  return { workflowPath: positional[0], noTui };
}
```

---

## 额外建议

### S1: Dashboard 刷新周期可配置

当前硬编码 1000ms。建议支持环境变量 `SYMPHONY_TUI_REFRESH_MS`，方便在高频交易场景下调低刷新率，或在低配终端上调高。

### S2: 加 `--dump-tui` 测试模式

加一个 `--dump-tui` flag（或环境变量），输出一帧渲染结果到文件而非 alternate screen。这样可以用 `bun test` 做回归测试，验证 layout 输出是否符合预期。

### S3: 测试策略补充

计划没有提及如何测试 TUI 模块。建议：

- `renderer.ts` / `format.ts` / `sparkline.ts` 是纯函数，可以直接单元测试
- `Dashboard` 类可以 mock `orchestrator.getState()` 和 `process.stdout.write` 做集成测试
- `events.ts` 的映射表可以用参数化测试覆盖所有已知事件类型

### S4: Bun TTY 兼容性额外检查

Bun 的 TTY 检测可能和 Node.js 有微妙差异。建议在 Task 4.4 的 Non-TTY fallback 中加一个额外检查：`process.env.TERM === "dumb"` 时也降级为 `--no-tui` 模式。

### S5: Fingerprint 优化实际收益有限

Fingerprint 不包含 `nextTickAt`，而 idle timer（1000ms）和刷新间隔（1000ms）相同。这意味着每个刷新周期要么状态变了（fingerprint 不同），要么 idle timer 到期。Fingerprint 的 skip-render 优化实际上几乎不会触发。可以考虑将 idle timer 设为 5s（间隔 1s 轮询状态，5s 才强制重绘），这样 fingerprint 优化才有实际意义——但这会导致 "Next refresh" 倒计时不流畅。建议保持当前设计，但明确文档说明 fingerprint 的主要价值是为后续 keyboard 交互事件驱动的重绘做准备。
