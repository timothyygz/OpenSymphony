## MODIFIED Requirements

### Requirement: Tracker adapter interface extension
The `TrackerAdapter` interface SHALL include the following required methods: `updateIssueJoinCommand`, `updateIssueProgress`, `updateIssueResultSummary`, `getMcpServerConfig`, `createIssue`, and `searchIssues`. Adapters that do not support optional methods SHALL silently skip the operations.

#### Scenario: Bitable adapter implements feedback methods
- **WHEN** the FeishuBitableAdapter is configured with `join_command_field`, `progress_field`, and `result_summary_field`
- **THEN** the adapter implements all three methods using the Bitable update API

#### Scenario: GitLab adapter implements feedback methods
- **WHEN** the GitLab adapter receives `updateIssueProgress` call
- **THEN** it SHALL update the issue description with a metadata block `<!-- symphony-progress: ... -->`

#### Scenario: Adapter implements MCP config
- **WHEN** any adapter's `getMcpServerConfig(issueId)` is called
- **THEN** it SHALL return an MCP server config with `tracker_tool` using the generic tracker tool implementation

#### Scenario: Adapter implements createIssue
- **WHEN** any adapter's `createIssue(data)` is called
- **THEN** it SHALL create a native record and return a mapped `Issue`

#### Scenario: Adapter implements searchIssues
- **WHEN** any adapter's `searchIssues(query)` is called
- **THEN** it SHALL search native records and return mapped `Issue[]`
