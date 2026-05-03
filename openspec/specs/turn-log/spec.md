## ADDED Requirements

### Requirement: Turn log file creation
The system SHALL create a `.symphony/turns.jsonl` file in each issue's workspace directory when the first turn starts. The `.symphony/` directory SHALL be created automatically if it does not exist.

#### Scenario: First turn creates log file
- **WHEN** the agent starts the first turn for an issue with workspace at `/tmp/symphony_workspaces/SYM-001`
- **THEN** the system creates `/tmp/symphony_workspaces/SYM-001/.symphony/turns.jsonl` as an empty file

#### Scenario: Subsequent turns append to existing log
- **WHEN** the agent starts the second turn for the same issue
- **THEN** the system appends to the existing `turns.jsonl` without truncating previous content

### Requirement: Prompt logging
The system SHALL log the prompt sent to Claude Code at the start of each turn as a JSON line with `role: "user"`, `turn` number, `content` (the rendered prompt text), and `timestamp`.

#### Scenario: First turn prompt is logged
- **WHEN** the orchestrator sends a Liquid-rendered prompt to Claude Code for turn 1
- **THEN** a line `{"turn":1,"role":"user","content":"...","timestamp":"..."}` is appended to turns.jsonl

#### Scenario: Continuation prompt is logged
- **WHEN** the orchestrator sends a continuation guidance prompt for turn 3
- **THEN** a line `{"turn":3,"role":"user","content":"Continuing work on SYM-001...","timestamp":"..."}` is appended

### Requirement: Assistant response logging
The system SHALL log each assistant text response as a JSON line with `role: "assistant"`, `turn` number, `content`, and `timestamp`.

#### Scenario: Assistant text is captured
- **WHEN** Claude Code outputs a message with type `assistant` containing text content
- **THEN** a line `{"turn":N,"role":"assistant","content":"...","timestamp":"..."}` is appended

### Requirement: Tool call logging
The system SHALL log each tool invocation as a JSON line with `role: "tool_use"`, `turn`, `tool` name, `input` parameters, and `timestamp`.

#### Scenario: File read is logged
- **WHEN** Claude Code reads a file via the Read tool
- **THEN** a line `{"turn":N,"role":"tool_use","tool":"Read","input":{"file_path":"src/main.ts"},"timestamp":"..."}` is appended

### Requirement: Tool result logging
The system SHALL log each tool result as a JSON line with `role: "tool_result"`, `turn`, `tool` name, `output` content (truncated to 10000 chars), and `timestamp`.

#### Scenario: Tool result is captured
- **WHEN** Claude Code returns a result from a tool invocation
- **THEN** a line `{"turn":N,"role":"tool_result","tool":"Read","output":"...","timestamp":"..."}` is appended

#### Scenario: Large tool result is truncated
- **WHEN** a tool result exceeds 10000 characters
- **THEN** the output field is truncated to 10000 characters with a `...[truncated]` suffix

### Requirement: Session metadata file
The system SHALL create a `.symphony/meta.json` file in the workspace when a session starts, containing `issueId`, `identifier`, `title`, `workspacePath`, `sessionId`, `joinCommand`, `startedAt`, `totalTurns` (updated per turn), and `totalTokens` (updated per turn).

#### Scenario: Meta file is created on dispatch
- **WHEN** an issue is dispatched and the first turn begins
- **THEN** `.symphony/meta.json` is written with initial values (`totalTurns: 0`, `totalTokens: 0`)

#### Scenario: Meta file is updated after each turn
- **WHEN** a turn completes successfully
- **THEN** `meta.json` is updated with incremented `totalTurns` and accumulated `totalTokens`

### Requirement: Log cleanup with workspace
The system SHALL NOT delete turn logs independently. Logs are removed when the workspace is cleaned up via `cleanupWorkspace()`.

#### Scenario: Workspace cleanup removes logs
- **WHEN** `cleanupWorkspace("SYM-001")` is called
- **THEN** the entire workspace directory including `.symphony/turns.jsonl` and `.symphony/meta.json` is removed
