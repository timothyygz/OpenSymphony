## Why

当前 Orchestrator dispatch 任务后，缺少对任务执行过程的可观测性：Claude Code 的对话内容被丢弃、多维表格里看不到进度、无法从任务跳转到对应的 agent 会话。同时 workspace 初始化只创建空目录，缺少从代码仓库（远端或本地）填充代码的能力，导致 agent 启动时面对的是空白 workspace。

## What Changes

- **Turn Log**：将每轮 Claude Code 的完整对话（prompt、assistant 回复、tool 调用及结果）记录到 workspace 下的 `.symphony/turns.jsonl`，提供可追溯的执行记录。
- **会话命令回写**：dispatch 时在多维表格写入一条 `claude --resume --session-id <id> --cwd <workspace>` 命令，用户复制即可进入该任务的 agent 会话。
- **进度回写**：每 turn 结束后，将进度信息（当前轮次、状态摘要）回写到多维表格的「进度」字段。
- **结果摘要**：任务正常完成时，将最后一轮 agent 的 result 内容写入多维表格的「结果摘要」字段。
- **Workspace Sources**：支持通过配置从多个远端仓库 `git clone` 或从本地仓库 `git worktree add` 初始化 workspace，两种方式可混用。
- **Worktree 清理**：使用 worktree 方式创建的 workspace，清理时调用 `git worktree remove` 而非直接 `rm -rf`，避免本地仓库残留 worktree 引用。

## Capabilities

### New Capabilities
- `turn-log`: 记录每轮 agent 对话的完整内容到 workspace 的结构化日志文件
- `tracker-feedback`: 将任务执行进度、会话命令、结果摘要等信息回写到飞书多维表格
- `workspace-sources`: 支持从远端仓库 clone 和本地仓库 worktree 两种方式初始化 workspace

### Modified Capabilities
<!-- 无现有 capability 需要修改 -->

## Impact

- **src/workspace/manager.ts**：新增 sources 初始化逻辑，cleanup 需区分 worktree 类型
- **src/workspace/hooks.ts**：可能需要调整 hook 执行时机（sources 初始化在 after_create hook 之前）
- **src/model/workflow.ts**：新增 `workspace.sources` 配置 schema（git-clone / git-worktree）
- **src/workflow/config.ts**：解析 sources 配置
- **src/orchestrator/orchestrator.ts**：dispatch 时写入会话命令、每 turn 后回写进度、完成时写入摘要
- **src/adapters/agent/claude-code/adapter.ts**：新增 `--session-id` 参数支持，扩展 `onEvent` 回调以传递完整消息内容
- **src/adapters/agent/claude-code/process.ts**：将 stdout 中的完整 JSON 事件传递给回调，而不仅是提取 token
- **src/adapters/tracker/types.ts**：新增 `updateIssueProgress`、`updateIssueSummary`、`updateIssueJoinCommand` 接口方法
- **src/adapters/tracker/feishu-bitable/adapter.ts**：实现新的 tracker 接口方法
- **src/adapters/tracker/feishu-bitable/mapper.ts**：新增字段映射（进度、结果摘要、操作命令）
- **WORKFLOW.md**：新增 `workspace.sources` 配置示例，新增 tracker 字段映射
