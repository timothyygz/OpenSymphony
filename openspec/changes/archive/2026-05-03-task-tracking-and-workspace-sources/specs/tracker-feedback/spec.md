## ADDED Requirements

### Requirement: Join command written on dispatch
The system SHALL write a join command string to the tracker issue when an issue is dispatched. The command format SHALL be `claude --resume --session-id <sessionId> --cwd <workspacePath>`.

#### Scenario: Dispatch writes join command
- **WHEN** the orchestrator dispatches issue SYM-001 with sessionId `SYM-001-1709000000000` and workspace path `/tmp/symphony_workspaces/SYM-001`
- **THEN** the tracker's "操作命令" field for this issue is updated to `claude --resume --session-id SYM-001-1709000000000 --cwd /tmp/symphony_workspaces/SYM-001`

#### Scenario: Join command field is configurable
- **WHEN** the workflow config specifies `tracker.join_command_field: "会话命令"`
- **THEN** the join command is written to the "会话命令" field in the tracker

### Requirement: Progress update per turn
The system SHALL update the tracker issue's progress field after each completed turn. The progress format SHALL be `Turn {turn}/{maxTurns}: {summary}` where summary is the last agent message truncated to 200 characters.

#### Scenario: Progress updated after turn completion
- **WHEN** turn 3 of 20 completes with the agent's last message being "Fixed the login validation bug in auth.ts"
- **THEN** the tracker's "进度" field is updated to `Turn 3/20: Fixed the login validation bug in auth.ts`

#### Scenario: Long message is truncated
- **WHEN** the agent's last message exceeds 200 characters
- **THEN** the summary is truncated to 200 characters with `...` suffix

#### Scenario: Progress field is configurable
- **WHEN** the workflow config specifies `tracker.progress_field: "执行进度"`
- **THEN** progress updates are written to the "执行进度" field

### Requirement: Result summary written on completion
The system SHALL write a result summary to the tracker issue when the worker exits normally. The summary SHALL be the last agent message or tool result from the final turn, truncated to 1000 characters.

#### Scenario: Successful completion writes summary
- **WHEN** a worker exits normally after completing all turns
- **THEN** the tracker's "结果摘要" field is updated with the final agent message

#### Scenario: No summary on failure
- **WHEN** a worker exits with reason "failed"
- **THEN** the tracker's "结果摘要" field is NOT updated (retains previous value or remains empty)

#### Scenario: Result summary field is configurable
- **WHEN** the workflow config specifies `tracker.result_summary_field: "完成摘要"`
- **THEN** the result summary is written to the "完成摘要" field

### Requirement: Tracker adapter interface extension
The `TrackerAdapter` interface SHALL be extended with three new optional methods: `updateIssueJoinCommand`, `updateIssueProgress`, and `updateIssueResultSummary`. Adapters that do not support these methods SHALL silently skip the operations.

#### Scenario: Bitable adapter implements feedback methods
- **WHEN** the FeishuBitableAdapter is configured with `join_command_field`, `progress_field`, and `result_summary_field`
- **THEN** the adapter implements all three methods using the Bitable update API

#### Scenario: Adapter without feedback support
- **WHEN** an adapter does not implement the feedback methods
- **THEN** the orchestrator catches the missing method and logs a debug message without failing

### Requirement: Session ID passed to agent
The system SHALL pass `--session-id <id>` to the Claude Code CLI when starting a session. The session ID format SHALL be `{identifier}-{timestamp}`.

#### Scenario: First turn includes session-id
- **WHEN** the agent runs the first turn for issue SYM-001
- **THEN** the CLI arguments include `--session-id SYM-001-1709000000000`

#### Scenario: Subsequent turns continue with same session-id
- **WHEN** the agent runs turn 2+ for the same issue
- **THEN** the CLI arguments include `--continue --session-id SYM-001-1709000000000`
