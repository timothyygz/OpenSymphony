## Context

当前 `ClaudeCodeAdapter` 位于 `src/adapters/agent/claude-code/`，由 4 个文件组成：
- `adapter.ts` — 主 Adapter，实现 `AgentAdapter` 接口
- `process.ts` — 通过 `Bun.spawn()` 启动 `claude -p` 子进程，流式读取 stdout NDJSON
- `parser.ts` — 解析 NDJSON 行为 `AgentEvent` 对象，提取消息、工具信息、token 用量
- `register.ts` — 注册到 Agent Registry

底层机制是 `claude -p --output-format stream-json --verbose`，每轮对话启动独立进程，后续轮次通过 `--resume <session_id>` 恢复上下文。

Anthropic 官方 `@anthropic-ai/claude-agent-sdk` 做的事情完全相同：封装 `claude -p --output-format stream-json` 子进程，但提供类型安全的 TypeScript API。

## Goals / Non-Goals

**Goals:**
- 用 SDK 的 `query()` 替换手动子进程管理，减少维护代码量
- 保持 `AgentAdapter` 接口不变，对上层调用方无感知
- 保留现有的所有能力：流式事件、会话恢复、token 用量、工具调用信息
- 支持 `permissionMode` 和 `executable: 'bun'` 配置

**Non-Goals:**
- 不引入 SDK 的高级功能（MCP Server、自定义 tool、sandbox、hooks）——仅作为 Adapter 的底层替换
- 不修改 `AgentAdapter` 接口本身
- 不修改其他 Adapter 实现
- 不修改上层 orchestrator 或 service 层

## Decisions

### 1. 使用 `query()` 而非 `startup()` + WarmQuery

**选择**: 每次 `runTurn` 直接调用 `query()`

**替代方案**: 使用 `startup()` 预热子进程，后续 `warmQuery.query()` 发送 prompt

**理由**: 当前架构是每轮独立调用 `runTurn`，`startup()` 适合长连接场景。后续如需优化延迟可引入，但初版保持简单。

### 2. 保留 `process.ts` 和 `parser.ts` 文件但删除内容

**选择**: 直接删除这两个文件

**理由**: SDK 完全接管了子进程管理和事件解析，这两个文件不再有任何用途。`register.ts` 保持不变。

### 3. SDK 消息到 `AgentEvent` 的映射策略

**选择**: 在 `adapter.ts` 内部实现 `mapSdkMessageToAgentEvent()` 函数

**映射关系**:
- `SDKAssistantMessage` → `event: "assistant"`, 提取 `message.content` 中的文本和工具调用
- `SDKResultMessage` → `event: "result"`, 提取 `usage` 和 `modelUsage`
- `SDKSystemMessage` → `event: "system"`, 提取 `session_id`
- `SDKPartialAssistantMessage` → `event: "stream_event"`, 可选（`includePartialMessages`）
- 其他消息类型 → `event: "system"`（通用处理）

**理由**: 集中在一个函数内，便于测试和维护。

### 4. 配置映射

| 现有配置 | SDK 选项 |
|---------|---------|
| `command` | `pathToClaudeCodeExecutable` |
| `outputFormat` | 不再需要（SDK 内部处理） |
| `timeoutMs` | `abortController` + `setTimeout` |
| `approvalPolicy: "auto"` | `permissionMode: "bypassPermissions"`, `allowDangerouslySkipPermissions: true` |

### 5. Token 用量提取

**选择**: 从 `SDKResultMessage.usage`（`NonNullableUsage`）和 `modelUsage` 提取

**映射**: `input_tokens` → `inputTokens`, `output_tokens` → `outputTokens`, 计算 `totalTokens`

## Risks / Trade-offs

- **[Bun 兼容性风险]** SDK 内部可能使用 Node.js API（如 `child_process`），Bun 运行时可能不完全兼容 → 先在本地 Bun 环境下安装并运行集成测试验证
- **[原生二进制依赖]** SDK 会安装平台特定的原生二进制（如 `darwin-arm64`），增加 `node_modules` 体积 → 如果包管理器跳过可选依赖，可通过 `pathToClaudeCodeExecutable` 指向已安装的 `claude` CLI
- **[SDK 版本更新]** SDK 可能跟随 Claude Code CLI 版本快速迭代，需要关注 breaking changes → 锁定主版本号，按需升级
