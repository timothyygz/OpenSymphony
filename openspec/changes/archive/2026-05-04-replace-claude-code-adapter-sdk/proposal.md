## Why

当前 `ClaudeCodeAdapter` 手动管理子进程（`Bun.spawn`）、NDJSON 解析、会话恢复等底层逻辑，代码分散在 4 个文件中（adapter.ts、process.ts、parser.ts、register.ts），维护成本高且缺乏类型安全。Anthropic 官方发布的 `@anthropic-ai/claude-agent-sdk` 提供了相同底层能力的 TypeScript 封装，支持 `AsyncGenerator<SDKMessage>` 流式事件、强类型消息、会话管理、权限控制等，可以大幅简化 Adapter 实现。

## What Changes

- 安装 `@anthropic-ai/claude-agent-sdk` 依赖
- 重写 `ClaudeCodeAdapter`，用 SDK 的 `query()` 替换手动 `Bun.spawn` + NDJSON 解析
- 删除 `process.ts`（子进程管理）和 `parser.ts`（NDJSON 解析），不再需要
- 保留 `register.ts` 注册入口和 `adapter.ts` 主体文件（重写内容）
- 更新 `types.ts` 中的 `AgentEvent` 映射，将 SDK 消息类型映射到现有事件接口
- 保持 `AgentAdapter` 接口不变，仅替换内部实现

## Capabilities

### New Capabilities
- `sdk-agent-adapter`: 基于 `@anthropic-ai/claude-agent-sdk` 的 Agent Adapter 实现，提供 `query()` 流式查询、会话恢复（`resume`）、权限控制（`permissionMode`）、token 用量提取、工具调用事件映射

### Modified Capabilities

## Impact

- **代码变更**: `src/adapters/agent/claude-code/` 目录下的 adapter.ts、process.ts、parser.ts
- **新增依赖**: `@anthropic-ai/claude-agent-sdk`（及其可选的原生二进制依赖）
- **接口兼容**: `AgentAdapter` 接口不变，对调用方无破坏性变更
- **Bun 兼容性**: SDK 支持 `executable: 'bun'` 选项，需验证在 Bun 运行时下的实际兼容性
