## Phase 1 - 基础设施（无依赖，可并行）

### 1. Workspace Sources Schema

- [x] 1.1 在 `src/model/workflow.ts` 中新增 `workspaceSourceSchema`：支持 `git-clone`（url, path, branch?, depth?）和 `git-worktree`（repo, path?, branch?）两种类型，使用 `z.discriminatedUnion`
- [x] 1.2 在 `workspaceConfigSchema` 中新增 `sources` 字段，类型为 `z.array(workspaceSourceSchema).optional().default([])`
- [x] 1.3 在 `src/workspace/safety.ts` 中新增 `expandPath` 支持 `~` 展开和相对路径解析（用于 worktree repo 路径）

### 2. AgentEvent 扩展

- [x] 2.1 在 `src/adapters/agent/types.ts` 中定义 `ClaudeStreamEvent` 接口（type, message?, tool_name?, tool_input?, result?, [key: string]: unknown）
- [x] 2.2 在 `AgentEvent` 接口中新增可选字段 `rawEvent?: ClaudeStreamEvent`、`toolName?: string`、`toolInput?: unknown`
- [x] 2.3 修改 `src/adapters/agent/claude-code/parser.ts` 的 `mapToAgentEvent()`：将原始 JSON 对象赋值到 `rawEvent`，从 rawEvent 提取 `toolName` 和 `toolInput`

### 3. Session ID 支持

- [x] 3.1 验证 Claude Code CLI `--continue` + `--session-id` 组合的兼容性
- [x] 3.2 修改 `src/adapters/agent/claude-code/adapter.ts` 的 `runTurn()`：在 args 中添加 `--session-id <sessionId>`，第一轮和续接轮都带上
- [x] 3.3 修改 `startSession()`：将 sessionId 保存到 session.metadata 中

## Phase 2 - 核心功能（依赖 Phase 1）

### 4. createForIssue 异步化重构

- [x] 4.1 将 `WorkspaceManager.createForIssue()` 从同步改为 `async`：返回 `Promise<Workspace>`，`mkdirSync` 改为 `mkdir` (Bun)
- [x] 4.2 修复 `after_create` hook 未 await 的问题：改为 `await runHookIfConfigured()`
- [x] 4.3 修改 `src/orchestrator/orchestrator.ts` 的 `runWorker()`：将 `workspaceManager.createForIssue()` 改为 `await`

### 5. Workspace Sources 初始化

- [x] 5.1 新建 `src/workspace/sources.ts`，实现 `initSources(sources, workspacePath, config)` 函数：遍历 sources 配置，按类型调用对应的 git 命令
- [x] 5.2 实现 `cloneSource(source, workspacePath)`：执行 `git clone [--depth N] [--branch B] <url> <workspace>/<path>`
- [x] 5.3 实现 `addWorktree(source, workspacePath)`：执行 `git -C <repo> worktree add <workspace>/<path> [--detach HEAD | -b <branch>]`
- [x] 5.4 实现回滚逻辑：在 `initSources()` 中记录已成功的 sources，后续失败时逆序执行清理（worktree → remove, clone → rm -rf）
- [x] 5.5 修改 `WorkspaceManager.createForIssue()`：在 `mkdir` 之后、`after_create` hook 之前调用 `await initSources()`，仅在 `createdNow` 时执行
- [x] 5.6 编写 workspace sources 初始化的单元测试

### 6. Turn Log 记录

- [x] 6.1 新建 `src/logging/turn-log.ts`，实现 `TurnLog` 类：`append(entry)` 追加 JSONL 行，接受 `{ turn, role, content?, tool?, input?, output?, timestamp }` 结构
- [x] 6.2 实现 `createTurnLogDir(workspacePath)`：确保 `.symphony/` 目录存在
- [x] 6.3 实现 `writeMetaJson(workspacePath, meta)` 和 `updateMetaJson(workspacePath, updates)`：写入/更新 `.symphony/meta.json`，meta 中包含 sources 配置快照及 hash
- [x] 6.4 修改 `src/orchestrator/orchestrator.ts` 的 `runWorker()`：turn 开始前记录 prompt（role: user）到 TurnLog
- [x] 6.5 修改 `onAgentEvent()` 回调：从 rawEvent 提取 assistant 消息、tool_use、tool_result，写入 TurnLog
- [x] 6.6 turn 完成后调用 `updateMetaJson()` 更新 totalTurns 和 totalTokens

## Phase 3 - Tracker 反馈（依赖 Phase 1）

### 7. Tracker 反馈接口与实现

- [x] 7.1 在 `src/adapters/tracker/types.ts` 的 `TrackerAdapter` 接口中新增可选方法：`updateIssueJoinCommand?`、`updateIssueProgress?`、`updateIssueResultSummary?`
- [x] 7.2 在 `src/model/workflow.ts` 的 `trackerConfigSchema` 中新增可选字段：`join_command_field`、`progress_field`、`result_summary_field`
- [x] 7.3 在 `FeishuBitableConfig` 中新增 `joinCommandField?`、`progressField?`、`resultSummaryField?`
- [x] 7.4 实现 `updateIssueJoinCommand()`、`updateIssueProgress()`、`updateIssueResultSummary()`：如果配置了对应字段，调用 `api.updateRecord()` 写入
- [x] 7.5 在 `createFeishuBitableAdapter()` 工厂函数中传入新字段的配置映射

## Phase 4 - Worktree 清理（依赖 Phase 2）

### 8. Worktree 清理

- [x] 8.1 在 `src/workspace/sources.ts` 中实现 `cleanupSources(metaJson)`：从 meta.json 读取创建时的 sources 快照，worktree 类型调用 `git worktree remove`，clone 类型跳过
- [x] 8.2 修改 `WorkspaceManager.cleanupWorkspace()`：在 `rm -rf` 之前读取 `.symphony/meta.json` 并调用 `cleanupSources()`
- [x] 8.3 worktree remove 失败时记录 warning 并 fallback 到直接 rm -rf

## Phase 5 - Orchestrator 集成（依赖 Phase 2-4）

### 9. Orchestrator 集成

- [x] 9.1 修改 `dispatchIssue()`：dispatch 时调用 `tracker.updateIssueJoinCommand()` 写入 `claude --resume --session-id <id> --cwd <workspace>` 命令
- [x] 9.2 修改 `dispatchIssue()`：写入 meta.json 初始内容（sessionId, workspacePath, joinCommand, sources 快照及 hash）
- [x] 9.3 修改 turn 循环：每 turn 完成后提取摘要（优先 assistant text，fallback 到 tool 名列表），调用 `tracker.updateIssueProgress()` 更新进度
- [x] 9.4 修改 `onWorkerExit()`：正常退出时调用 `tracker.updateIssueResultSummary()` 写入结果摘要
- [x] 9.5 所有 tracker 反馈调用使用 `.catch()` 静默失败，不影响核心流程

## Phase 6 - 文档与测试（依赖所有）

### 10. WORKFLOW.md 与测试

- [x] 10.1 更新项目根目录 `WORKFLOW.md`：新增 `workspace.sources` 配置示例，新增 tracker 字段映射
- [x] 10.2 编写 `TurnLog` 单元测试：验证 JSONL 追加、meta.json 读写、大内容截断
- [x] 10.3 编写 `initSources` 单元测试：验证 git-clone 参数、worktree 参数、混合 sources 顺序、部分失败回滚
- [x] 10.4 编写 orchestrator 集成测试：验证 dispatch 写入 join command、turn 更新 progress、正常退出写入 summary
