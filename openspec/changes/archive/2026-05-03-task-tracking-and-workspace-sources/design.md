## Context

Symphony Orchestrator 当前调度任务后，agent 子进程的对话内容通过 stdout 流式读取但只提取了 token usage，完整消息被丢弃。多维表格（飞书 Bitable）只同步状态和 token 消耗，缺少执行过程的可见性。Workspace 创建时只 `mkdir` 空目录，依赖 `after_create` hook 手动配置 clone 命令，没有结构化的代码源管理。

现有架构：
- `ClaudeCodeAdapter.runTurn()` 每个 turn spawn 一个 `claude` 子进程，用 `--continue` 续接会话
- `process.ts` 通过 `onEvent` 回调传递 `AgentEvent`（仅 event/message/usage）
- `FeishuBitableAdapter` 通过字段映射读写多维表格
- `WorkspaceManager.createForIssue()` 是同步方法（mkdirSync/existsSync），`after_create` hook 用 `.catch()` 触发但未 await

## Goals / Non-Goals

**Goals:**
- 完整记录每轮 agent 对话内容，支持事后回溯
- 从多维表格可直接进入任务的 agent 会话
- 多维表格中可见任务执行进度和最终结果
- Workspace 支持从多个远端/本地代码仓库初始化
- Worktree 方式的 workspace 正确清理

**Non-Goals:**
- 不做实时 WebSocket 推送（进度更新通过 poll 周期回写多维表格）
- 不做 agent 过程中的实时人工介入（只在 turn 间隔可观察）
- 不替换现有的 `after_create` hook 机制（sources 是补充，不取代 hook）
- 不做 SSH 远程 Worker（保持本地执行模式）

## Decisions

### D0: createForIssue 异步化

**决定**：将 `WorkspaceManager.createForIssue()` 从同步改为 `async`。执行顺序变为 `await mkdir → await initSources → await after_create hook`。

**理由**：
- sources 初始化需要执行 git 命令（spawn 子进程），是异步操作
- 当前的 `after_create` hook 未被 await，是一个既有 bug——agent 可能在 hook 完成前就启动了
- `runWorker()` 本身已经是 async，改为 `await createForIssue()` 是自然的

### D1: Turn Log 存储位置

**决定**：存储在 workspace 目录下的 `.symphony/turns.jsonl`。

**理由**：
- 与 workspace 生命周期绑定，清理 workspace 时日志一并清理
- agent 子进程的 cwd 就是 workspace，日志和数据在同一位置方便调试
- JSONL 格式支持追加写入，不需要复杂的日志框架

**备选方案**：
- 集中存储到一个全局日志文件 → 跨任务查询方便，但文件会无限增长
- 存储到多维表格 → 字段大小有限，不适合大量文本

### D2: Session 复用方式

**决定**：使用 `--session-id` 参数而非仅 `--continue`。

**理由**：
- `--session-id` 提供明确的会话标识，可以用于 `claude --resume` 恢复
- 用户从多维表格复制命令时，用 `--resume --session-id` 比 `--continue` 更明确
- session-id 使用 `{identifier}-{timestamp}` 格式，可读且唯一

### D3: Workspace Sources 配置在 workflow 层

**决定**：在 `WORKFLOW.md` 的 `workspace.sources` 配置，而非代码中硬编码。

**理由**：
- 不同项目需要 clone 不同的仓库，配置化更灵活
- 与现有 WORKFLOW.md 热加载机制兼容，修改仓库不需要重启
- 与 `after_create` hook 互不冲突：sources 先执行，hook 后执行

### D4: Sources 初始化在 after_create hook 之前

**决定**：执行顺序为 `mkdir → sources init → after_create hook`。

**理由**：
- sources 负责拉取代码，hook 可以做额外的项目初始化（如 `npm install`）
- 如果 sources 失败（如网络错误），不执行 hook，workspace 创建失败
- workspace 复用时（`createdNow = false`）不重新执行 sources 和 hook

### D5: Worktree 清理策略

**决定**：cleanup 时读取 `.symphony/meta.json` 中保存的 sources 配置快照。worktree 类型调用 `git worktree remove`，clone 类型直接 `rm -rf`。

**理由**：
- `git worktree` 在主仓库的 `.git/worktrees/` 下保留了引用，直接 `rm -rf` 会留下过期的 worktree 记录
- `git worktree remove` 会同时清理引用和目录
- 使用 meta.json 中的快照而非当前配置，因为 workspace 创建后 workflow 配置可能被热加载更新

**备选方案**：
- 将当前 sources 配置传给 cleanupWorkspace() → 简单但可能不一致（配置已变）

### D6: 进度回写策略

**决定**：每 turn 结束后回写，而非实时推送。

**理由**：
- 当前架构是 poll-based（每 30s 一个 tick），没有实时推送通道
- 回写多维表格有 API 开销，每 turn 一次是合理的频率

**摘要提取逻辑**：
- 优先取 `assistant` 类型的 text 消息
- 如果 turn 中没有 assistant 消息（只有 tool 调用），使用 `"Turn {n}/{max}: Tool calls ({tool1}, {tool2}, ...)"`
- 摘要截断到 200 字符

### D7: AgentEvent 扩展

**决定**：扩展 `AgentEvent` 接口，新增结构化的 `rawEvent` 字段（类型为 `ClaudeStreamEvent`），以及 `toolName`、`toolInput` 字段。

```typescript
interface ClaudeStreamEvent {
  type: string;
  message?: { content: unknown[]; usage?: unknown };
  tool_name?: string;
  tool_input?: unknown;
  result?: string;
  [key: string]: unknown;
}
```

**理由**：
- 现有 `onEvent` 只传递了 event/message/usage，丢失了 tool 调用详情
- 使用 `ClaudeStreamEvent` 而非 `unknown` 提供基本类型提示，同时保留 `[key: string]: unknown` 透传未知字段
- Turn Log 记录器可以从 `rawEvent` 提取完整内容

### D8: Sources 部分失败回滚

**决定**：`initSources()` 中如果某个 source 失败，对已成功的 sources 执行逆操作（worktree → `git worktree remove`，clone → `rm -rf`），然后删除 workspace 目录。

**理由**：
- 多个 sources 可能第 1 个成功第 2 个失败，留下不一致的状态
- worktree 类型的 source 必须正确清理，否则本地仓库残留 worktree 引用

## Risks / Trade-offs

**[大量日志文件]** → 每个 workspace 一个 turns.jsonl，任务多时磁盘占用增加。Mitigation：workspace 清理时一并删除；可考虑设置日志文件大小上限。

**[多维表格 API 频率]** → 每 turn 回写进度增加 API 调用。Mitigation：飞书 API 有频率限制，但每 30s 内几次写入在合理范围内；如果并发任务多，可以考虑批量写入或降频。

**[Worktree 并发冲突]** → 多个任务从同一个本地仓库创建 worktree 时，git 会修改主仓库 `.git/worktrees/` 目录。Mitigation：git 内部有 lock 文件保护，并发 worktree add 通常安全，但在极端并发下可能因 lock contention 临时失败，触发正常的重试机制即可。

**[after_create hook 与 sources 语义冲突]** → 用户可能同时配置了 sources 中的 git-clone 和 after_create 中也 clone。Mitigation：文档中明确说明执行顺序；如果 workspace 已有代码（sources 执行成功），hook 中的 clone 命令会失败但不影响（目录非空），hook 应该做 `npm install` 等后续步骤。

**[Claude Code stream-json 输出格式不稳定]** → Anthropic 可能改变输出格式。Mitigation：parser.ts 已有容错处理（非 JSON 当 message 处理），`rawEvent` 直接存储原始 JSON，后续可调整解析逻辑。
