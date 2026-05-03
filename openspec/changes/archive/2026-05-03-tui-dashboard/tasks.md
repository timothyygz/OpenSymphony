## 1. ANSI 渲染基础设施

- [x] 1.1 创建 `src/tui/renderer.ts` — ANSI 颜色常量、光标控制、alternate screen 切换（enterAltScreen / exitAltScreen）、clearScreen、drawLines
- [x] 1.2 创建 `src/tui/format.ts` — `displayWidth()` CJK 宽度计算、`padCell()` 基于显示宽度对齐、`formatCount()` 千分位、`formatRuntime()` 时间格式化、`truncate()` 截断

## 2. 事件映射与迷你图

- [x] 2.1 创建 `src/tui/events.ts` — Claude Code stream-json 事件类型 → 人类可读标签 + 颜色的映射表，含 fallback 处理；同时包含 rateLimits defensive formatting 函数（`state.rateLimits` 为 `unknown` 或结构不符时返回 "N/A"）
- [x] 2.2 创建 `src/tui/sparkline.ts` — Sparkline 类内部维护环形缓冲区（ring buffer），每秒从 `state.aggregateTotals.totalTokens` 采样并计算差值作为 TPS；10 分钟窗口（600 采样点）降采样为 24 bucket 后映射到 ▁▂▃▄▅▆▇█

## 3. 布局渲染

- [x] 3.1 创建 `src/tui/layout.ts` — `formatHeader()`: Agents/Completed、Throughput+sparkline、Runtime、Tokens、Rate Limits（defensive）、Next refresh（`nextTickAt < Date.now()` 时显示 "refreshing..."）
- [x] 3.2 在 `layout.ts` 中实现 `formatRunningTable()`: 6 列表格（ID/TITLE/STATE/AGE-AND-TURN/TOKENS/EVENT），动态 EVENT 列宽，状态圆点着色，按 identifier 排序
- [x] 3.3 在 `layout.ts` 中实现 `formatBackoffQueue()`: 重试条目列表（↻ identifier attempt=N in Xs error=...），空队列显示 "No queued retries"

## 4. Dashboard 主类

- [x] 4.1 创建 `src/tui/dashboard.ts` — Dashboard 类：constructor 接收 orchestrator 引用和可选 refreshMs（支持 `SYMPHONY_TUI_REFRESH_MS` 环境变量）；`start()` 进入 alternate screen、启动 setInterval 渲染循环、监听 `process.stdout` `'resize'` 事件触发强制 re-render
- [x] 4.2 在 `dashboard.ts` 中实现 `stateFingerprint()`: 关键字段拼接（running identifiers + events + token totals + retry ids + completed size）
- [x] 4.3 在 `dashboard.ts` 中实现 `render()`: getState → fingerprint 比较 → layout.format → renderer.draw
- [x] 4.4 在 `dashboard.ts` 中实现 `stop()`: clearInterval + 移除 resize listener + exitAltScreen + TTY/TERM=dumb 检测 + Non-TTY fallback

## 5. Orchestrator 状态扩展

- [x] 5.1 修改 `src/orchestrator/state.ts` — OrchestratorState 接口新增 `nextTickAt: number | null`，`createInitialState()` 初始化为 null
- [x] 5.2 修改 `src/orchestrator/orchestrator.ts` — `scheduleTick()` 中设置 `this.state.nextTickAt = Date.now() + this.state.pollIntervalMs`

## 6. Logger 与 CLI 集成

- [x] 6.1 修改 `src/logging/logger.ts` — 改为 Proxy 懒初始化模式：导出 `new Proxy({} as pino.Logger, { get(_, prop) { return Reflect.get(getLogger(), prop) } })`，内部 `getLogger()` 在首次调用时读取 `SYMPHONY_LOG_DEST` 环境变量并创建 pino 实例
- [x] 6.2 修改 `src/cli.ts` — `parseArgs()` 支持 `--no-tui` flag 和位置参数混合解析（`args.filter(a => !a.startsWith("-"))`）；TUI 模式判断：`!noTui && process.stdout.isTTY && process.env.TERM !== "dumb"`；TUI 模式下在 `main()` 顶部设置 `process.env.SYMPHONY_LOG_DEST = "stderr"`
- [x] 6.3 修改 `src/cli.ts` — 创建并启动 Dashboard 实例，绑定到 SIGINT/SIGTERM 优雅关闭流程（先 stop dashboard 再 stop orchestrator）

## 7. 测试

- [x] 7.1 为 `format.ts` 编写单元测试：`displayWidth()` CJK 计算、`padCell()` 对齐、`formatCount()` 千分位、`truncate()` 截断
- [x] 7.2 为 `sparkline.ts` 编写单元测试：TPS 计算、sparkline 生成、边界情况（空数据/满数据/降采样）
- [x] 7.3 为 `events.ts` 编写单元测试：所有已知事件类型映射 + unknown fallback
