## 1. 安装依赖

- [x] 1.1 安装 `@anthropic-ai/claude-agent-sdk`，验证在 Bun 运行时下可正常 import
- [x] 1.2 验证 SDK 的原生二进制依赖（`darwin-arm64`）正确安装或可回退到本地 `claude` CLI

## 2. 实现 SDK 消息映射

- [x] 2.1 在 `adapter.ts` 中实现 `mapSdkMessageToAgentEvent()` 函数，映射 `SDKAssistantMessage` → `AgentEvent`
- [x] 2.2 映射 `SDKResultMessage` → `AgentEvent`（含 usage 提取）和 `TurnResult` 返回值
- [x] 2.3 映射 `SDKSystemMessage` → `AgentEvent`（含 session_id 提取）
- [x] 2.4 实现 token 用量提取：从 `SDKResultMessage.usage` 和 `modelUsage` 映射到 `TokenUsage`

## 3. 重写 Adapter

- [x] 3.1 重写 `startSession()` — 保留现有逻辑（创建 session metadata）
- [x] 3.2 重写 `runTurn()` — 使用 `query()` + `for await` 遍历 SDK 消息，调用 `mapSdkMessageToAgentEvent()` 转发事件
- [x] 3.3 实现首轮（无 resume）和后续轮次（resume: sessionId）的分支逻辑
- [x] 3.4 实现超时控制 — 使用 `AbortController` + `setTimeout` 替代原有 SIGTERM 逻辑
- [x] 3.5 实现配置映射 — `command` → `pathToClaudeCodeExecutable`，`approvalPolicy` → `permissionMode` + `allowDangerouslySkipPermissions`
- [x] 3.6 重写 `stopSession()` — 调用活跃 query 的 `close()` 方法

## 4. 清理旧实现

- [x] 4.1 删除 `src/adapters/agent/claude-code/process.ts`
- [x] 4.2 删除 `src/adapters/agent/claude-code/parser.ts`
- [x] 4.3 确认 `register.ts` 无需修改，仍然正确导出 `createClaudeCodeAdapter`

## 5. 验证

- [x] 5.1 确认 `bun run src/` 或主入口可正常加载 adapter 模块无报错
- [x] 5.2 确认类型检查通过（无 TypeScript 错误）
- [x] 5.3 确认无残留 import 引用 `process.ts` 或 `parser.ts`
