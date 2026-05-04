## ADDED Requirements

### Requirement: SDK-based Agent Adapter implements AgentAdapter interface
`ClaudeCodeAdapter` SHALL use `@anthropic-ai/claude-agent-sdk` 的 `query()` 函数作为底层实现，同时保持 `AgentAdapter` 接口不变。

#### Scenario: startSession creates session metadata
- **WHEN** `startSession(ctx)` 被调用
- **THEN** 返回一个 `AgentSession` 对象，包含 `id`、`turnCount: 0`、`metadata`（含 `workspacePath`、`sessionId`）

#### Scenario: runTurn uses SDK query on first turn
- **WHEN** `runTurn(session, prompt, onEvent)` 被调用且 `turnCount === 0`
- **THEN** 调用 `query({ prompt, options: { cwd, ... } })` 发起新会话，遍历 `AsyncGenerator<SDKMessage>` 并通过 `onEvent` 回调转发事件

#### Scenario: runTurn resumes session on subsequent turns
- **WHEN** `runTurn(session, prompt, onEvent)` 被调用且 `turnCount > 0`
- **THEN** 调用 `query({ prompt, options: { resume: sessionId, cwd, ... } })` 恢复已有会话

#### Scenario: stopSession closes active query
- **WHEN** `stopSession(session)` 被调用时存在活跃的 query
- **THEN** 调用 `query.close()` 终止底层进程

### Requirement: SDK messages map to AgentEvent
Adapter SHALL 将 SDK 消息类型映射到现有的 `AgentEvent` 结构。

#### Scenario: SDKAssistantMessage maps to assistant event
- **WHEN** 收到 `SDKAssistantMessage`
- **THEN** 映射为 `{ event: "assistant", message: <extracted text>, toolName: <extracted name>, toolInput: <extracted input>, sessionId: <session_id> }`

#### Scenario: SDKResultMessage maps to result event with usage
- **WHEN** 收到 `SDKResultMessage`（subtype: "success"）
- **THEN** 映射为 `{ event: "result", usage: { inputTokens, outputTokens, totalTokens } }`，并从 `modelUsage` 提取 token 用量

#### Scenario: SDKResultMessage error maps to failed TurnResult
- **WHEN** 收到 `SDKResultMessage`（subtype 非 "success"）
- **THEN** `runTurn` 返回 `{ status: "failed", error: <errors joined> }`

#### Scenario: SDKSystemMessage maps to system event
- **WHEN** 收到 `SDKSystemMessage`（subtype: "init"）
- **THEN** 映射为 `{ event: "system", sessionId: <session_id> }`，并记录 `realSessionId`

### Requirement: Configuration maps to SDK options
Adapter SHALL 将现有配置字段映射到 SDK Options。

#### Scenario: command maps to pathToClaudeCodeExecutable
- **WHEN** 配置中指定了 `command`（非默认值 "claude"）
- **THEN** 传递 `pathToClaudeCodeExecutable` 到 SDK Options

#### Scenario: approvalPolicy auto maps to bypassPermissions
- **WHEN** 配置中 `approvalPolicy` 为 `"auto"`
- **THEN** 设置 `permissionMode: "bypassPermissions"` 和 `allowDangerouslySkipPermissions: true`

#### Scenario: timeout maps to AbortController
- **WHEN** 配置中指定了 `timeoutMs`
- **THEN** 创建 `AbortController`，在超时后调用 `abort()`，并传递给 SDK Options

### Requirement: Session ID tracking via SDK messages
Adapter SHALL 从 SDK 消息中提取并存储真实的 session ID 用于后续恢复。

#### Scenario: Session ID captured from system init message
- **WHEN** 收到 `SDKSystemMessage`（subtype: "init"）
- **THEN** 将 `session_id` 存入 `session.metadata.realSessionId`

#### Scenario: Resume uses realSessionId
- **WHEN** 后续轮次调用 `runTurn` 且 `realSessionId` 已记录
- **THEN** 使用 `realSessionId` 作为 `options.resume` 的值

### Requirement: Remove process.ts and parser.ts
`process.ts` 和 `parser.ts` SHALL 被删除，其功能完全由 SDK 接管。

#### Scenario: process.ts removed from codebase
- **WHEN** 变更完成
- **THEN** `src/adapters/agent/claude-code/process.ts` 文件不存在

#### Scenario: parser.ts removed from codebase
- **WHEN** 变更完成
- **THEN** `src/adapters/agent/claude-code/parser.ts` 文件不存在

#### Scenario: No import references to deleted files
- **WHEN** 变更完成
- **THEN** 项目中无任何 import 引用 `process.ts` 或 `parser.ts` 中的导出
