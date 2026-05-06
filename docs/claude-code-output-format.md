# Claude Code CLI Output Format Reference

> Based on Claude Code v2.1.x, tested and verified on 2026-05-04.

## Overview

Claude Code CLI supports three output formats via `--output-format`:

| Format | Description | Usage |
|--------|-------------|-------|
| `text` | Plain text (default) | `claude -p "query"` |
| `json` | Single JSON result object | `claude -p --output-format json "query"` |
| `stream-json` | NDJSON streaming events | `claude -p --output-format stream-json --verbose "query"` |

---

## 1. JSON Output (`--output-format json`)

Returns a single JSON object after completion. Example:

```bash
claude -p --output-format json "explain this function"
```

### Complete Response Structure

```json
{
  "type": "result",
  "subtype": "success",
  "is_error": false,
  "api_error_status": null,
  "duration_ms": 3257,
  "duration_api_ms": 2535,
  "num_turns": 1,
  "result": "Hello! How can I help you today?",
  "stop_reason": "end_turn",
  "session_id": "ab3cb2e7-fdd1-4086-bfb0-59bb5ff5a4d5",
  "total_cost_usd": 0.156362,
  "usage": { ... },
  "modelUsage": { ... },
  "permission_denials": [],
  "terminal_reason": "completed",
  "fast_mode_state": "off",
  "uuid": "a812fd7b-6345-4c34-b0bb-5a1889f6b36c"
}
```

### Field Reference

#### Top-Level Fields

| Field | Type | Description |
|-------|------|-------------|
| `type` | `string` | Always `"result"` for JSON output |
| `subtype` | `string` | Result subtype. Enums: `"success"`, `"error"` |
| `is_error` | `boolean` | Whether the response resulted in an error |
| `api_error_status` | `number \| null` | API error status code, `null` if no error |
| `duration_ms` | `number` | Total wall-clock duration in milliseconds |
| `duration_api_ms` | `number` | API call duration in milliseconds |
| `num_turns` | `number` | Number of agentic turns taken |
| `result` | `string` | The model's text response. Empty string on error |
| `stop_reason` | `string` | Why the model stopped generating. See enums below |
| `session_id` | `string` | UUID of this session, usable with `--resume` |
| `total_cost_usd` | `number` | Total cost in USD for this request |
| `usage` | `object` | Token usage breakdown. See below |
| `modelUsage` | `object` | Per-model usage breakdown. See below |
| `permission_denials` | `array` | List of tool permission denials (usually empty `[]`) |
| `terminal_reason` | `string` | Why the session ended. Enums: `"completed"`, `"error"`, `"max_turns"`, `"budget_exceeded"` |
| `fast_mode_state` | `string` | Fast mode status. Enums: `"off"`, `"on"` |
| `uuid` | `string` | Unique identifier for this specific response |

#### `stop_reason` Enums

| Value | Description |
|-------|-------------|
| `"end_turn"` | Model completed its response naturally |
| `"max_tokens"` | Model hit the maximum output token limit |
| `"stop_sequence"` | Model hit a stop sequence |
| `"tool_use"` | Model wants to use a tool (continues to next turn) |

#### `terminal_reason` Enums

| Value | Description |
|-------|-------------|
| `"completed"` | Session finished successfully |
| `"error"` | Session ended due to an error |
| `"max_turns"` | Session ended because `--max-turns` limit was reached |
| `"budget_exceeded"` | Session ended because `--max-budget-usd` limit was reached |

#### `usage` Object

| Field | Type | Description |
|-------|------|-------------|
| `input_tokens` | `number` | Total input tokens consumed |
| `cache_creation_input_tokens` | `number` | Tokens used to create new cache entries |
| `cache_read_input_tokens` | `number` | Tokens read from prompt cache (cached hits) |
| `output_tokens` | `number` | Output tokens generated |
| `server_tool_use` | `object` | Server-side tool usage counts |
| `service_tier` | `string` | Service tier used. Enums: `"standard"`, `"priority"` |
| `cache_creation` | `object` | Cache creation breakdown by TTL |
| `inference_geo` | `string` | Geographic region of inference |
| `iterations` | `array` | Per-iteration details (usually `[]`) |
| `speed` | `string` | Inference speed. Enums: `"standard"`, `"fast"` |

#### `server_tool_use` Object

| Field | Type | Description |
|-------|------|-------------|
| `web_search_requests` | `number` | Number of web search API calls |
| `web_fetch_requests` | `number` | Number of web fetch API calls |

#### `cache_creation` Object

| Field | Type | Description |
|-------|------|-------------|
| `ephemeral_1h_input_tokens` | `number` | Tokens cached with 1-hour TTL |
| `ephemeral_5m_input_tokens` | `number` | Tokens cached with 5-minute TTL |

#### `modelUsage` Object

Keyed by model name (e.g., `"glm-5.1"`, `"claude-sonnet-4-6"`):

| Field | Type | Description |
|-------|------|-------------|
| `inputTokens` | `number` | Input tokens for this model |
| `outputTokens` | `number` | Output tokens for this model |
| `cacheReadInputTokens` | `number` | Cache read tokens for this model |
| `cacheCreationInputTokens` | `number` | Cache creation tokens for this model |
| `webSearchRequests` | `number` | Web search requests via this model |
| `costUSD` | `number` | Cost in USD for this model |
| `contextWindow` | `number` | Context window size for this model |
| `maxOutputTokens` | `number` | Maximum output tokens for this model |

---

## 2. Stream-JSON Output (`--output-format stream-json`)

Emits **NDJSON** (one JSON object per line) as real-time events. Requires `--verbose` for full output.

```bash
claude -p --output-format stream-json --verbose --include-partial-messages "query"
```

### Event Flow

```
system (hook_started)       ← hook lifecycle events
system (hook_response)
system (init)               ← session initialization
system (status)             ← "requesting" status
stream_event (message_start)     ← API call begins
stream_event (content_block_start)
stream_event (content_block_delta)  ← token-by-token text
stream_event (content_block_delta)
...
assistant                   ← complete assistant message
stream_event (content_block_stop)
stream_event (message_delta)      ← stop reason
stream_event (message_stop)
result                      ← final result object
```

### Event Types Reference

#### `type: "system"` — System Events

Emitted for session lifecycle events (hooks, init, status).

| `subtype` | Description | Key Fields |
|-----------|-------------|------------|
| `"hook_started"` | A hook started executing | `hook_id`, `hook_name`, `hook_event` |
| `"hook_response"` | A hook completed | `hook_id`, `hook_name`, `output`, `stdout`, `stderr`, `exit_code`, `outcome` |
| `"init"` | Session initialization | `cwd`, `session_id`, `tools`, `
servers`, `model`, `permissionMode`, `plugins`, `skills`, `agents`, `apiKeySource`, `claude_code_version`, `memory_paths` |
| `"status"` | Status update | `status` (e.g., `"requesting"`) |

##### `init` Event Fields

| Field | Type | Description |
|-------|------|-------------|
| `cwd` | `string` | Current working directory |
| `session_id` | `string` | Session UUID |
| `tools` | `array` | Available built-in tools (e.g., `["LSP"]`) |
| `mcp_servers` | `array` | Configured MCP servers |
| `model` | `string` | Model being used |
| `permissionMode` | `string` | Permission mode |
| `slash_commands` | `array` | Available slash commands/skills |
| `agents` | `array` | Available agent types |
| `plugins` | `array` | Loaded plugins with name, path, source |
| `apiKeySource` | `string` | API key source |
| `claude_code_version` | `string` | Claude Code CLI version |
| `memory_paths` | `object` | Auto-memory paths |

#### `type: "stream_event"` — Streaming Events

Emitted for each token/event from the API stream. The inner `event` object follows the Anthropic API streaming format.

| `event.type` | Description | Key Fields |
|---------------|-------------|------------|
| `"message_start"` | New message begins | `event.message.id`, `event.message.role`, `event.message.model` |
| `"content_block_start"` | New content block | `event.index`, `event.content_block.type` |
| `"content_block_delta"` | Incremental content | `event.index`, `event.delta.type`, `event.delta.text` |
| `"content_block_stop"` | Content block ends | `event.index` |
| `"message_delta"` | Message metadata update | `event.delta.stop_reason`, `event.usage` |
| `"message_stop"` | Message ends | (no extra fields) |

Additional fields on every `stream_event`:

| Field | Type | Description |
|-------|------|-------------|
| `session_id` | `string` | Session UUID |
| `parent_tool_use_id` | `string \| null` | Parent tool use ID if nested |
| `uuid` | `string` | Event UUID |
| `ttft_ms` | `number` | Time to first token (only on `message_start`) |

#### `type: "assistant"` — Complete Assistant Message

Emitted once per turn with the full assistant message.

| Field | Type | Description |
|-------|------|-------------|
| `message.id` | `string` | Message ID |
| `message.role` | `string` | Always `"assistant"` |
| `message.model` | `string` | Model used |
| `message.content` | `array` | Content blocks |
| `message.stop_reason` | `string \| null` | Why generation stopped |
| `parent_tool_use_id` | `string \| null` | Parent tool use ID if nested |
| `session_id` | `string` | Session UUID |

#### `type: "result"` — Final Result

Same structure as JSON output mode. See [Complete Response Structure](#complete-response-structure) above.

---

## 3. Structured Output (`--json-schema`)

Force the response to match a JSON Schema. Only works with `--output-format json`.

```bash
claude -p --output-format json \
  --json-schema '{"type":"object","properties":{"name":{"type":"string"}},"required":["name"]}' \
  "extract the function name"
```

Adds a `structured_output` field to the response:

```json
{
  "type": "result",
  "subtype": "success",
  "result": "The function name is...",
  "structured_output": {
    "name": "authenticate"
  },
  "session_id": "...",
  ...
}
```

| Field | Type | Description |
|-------|------|-------------|
| `structured_output` | `object \| null` | Validated JSON matching the provided schema. Only present when `--json-schema` is used |

---

## 4. Bidirectional Streaming (`--input-format stream-json`)

For programmatic agent chaining. Both input and output are NDJSON streams.

```bash
claude -p \
  --input-format stream-json \
  --output-format stream-json \
  --replay-user-messages
```

### Input Format

Send NDJSON lines via stdin:

```json
{"type":"user","content":"your prompt here"}
```

### Output

Same stream-json events as above, with user messages echoed back when `--replay-user-messages` is set.

---

## 5. Session Management Quick Reference

```bash
# Get session_id from JSON output
SESSION=$(claude -p --output-format json "start work")
SESSION_ID=$(echo "$SESSION" | jq -r '.session_id')

# Resume in TUI mode (interactive)
claude --resume "$SESSION_ID"

# Resume in print mode
claude -p --output-format json --resume "$SESSION_ID" "continue"

# Fork from existing session (new session ID)
claude --resume "$SESSION_ID" --fork-session

# Continue most recent session
claude -p --continue "next question"

# Specify custom session ID (must be UUID)
claude --session-id "550e8400-e29b-41d4-a716-446655440000" -p "query"

# Disable session persistence
claude -p --no-session-persistence "one-off query"
```

---

## Sources

- [CLI Reference - Claude Code Docs](https://code.claude.com/docs/en/cli-reference)
- [GitHub Issue #24596 - stream-json event type documentation](https://github.com/anthropics/claude-code/issues/24596)
- [Wrapping Claude CLI for Agentic Applications](https://avasdream.com/blog/claude-cli-agentic-wrapper)
- Real CLI testing output (2026-05-04)
