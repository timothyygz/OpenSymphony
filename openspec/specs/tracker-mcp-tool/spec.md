## ADDED Requirements

### Requirement: Generic tracker MCP tool
The system SHALL provide a single tracker-agnostic MCP tool named `tracker_tool` that operates through the `TrackerAdapter` interface. Agents SHALL NOT be aware of the underlying tracker type.

#### Scenario: Tool registration
- **WHEN** a worker starts for an issue
- **THEN** the system SHALL create an MCP server with `tracker_tool` using the configured adapter
- **AND** the tool description SHALL explain generic actions (create, get, update, list, search) without mentioning any specific tracker backend

#### Scenario: List action
- **WHEN** agent calls `tracker_tool` with action `list` and optional `states` parameter
- **THEN** the tool SHALL call `adapter.fetchIssuesByStates(states)` or `adapter.fetchCandidateIssues()` if no states given
- **AND** return an array of issue objects

#### Scenario: Get action
- **WHEN** agent calls `tracker_tool` with action `get` and `id` parameter
- **THEN** the tool SHALL call `adapter.fetchIssuesByStates(["*"])` and return the matching issue

#### Scenario: Create action
- **WHEN** agent calls `tracker_tool` with action `create`, `title`, and optional `description`, `state`
- **THEN** the tool SHALL call `adapter.createIssue({ title, description, state })`
- **AND** return the created issue

#### Scenario: Update action
- **WHEN** agent calls `tracker_tool` with action `update`, `id`, and optional `state`, `progress`, `summary`
- **THEN** the tool SHALL call the corresponding adapter update methods (`updateIssueState`, `updateIssueProgress`, `updateIssueResultSummary`)

#### Scenario: Search action
- **WHEN** agent calls `tracker_tool` with action `search` and `query` parameter
- **THEN** the tool SHALL call `adapter.searchIssues(query)` and return matching issues

### Requirement: getMcpServerConfig is mandatory
The `getMcpServerConfig(issueId)` method SHALL be required on the `TrackerAdapter` interface. All tracker adapters MUST implement this method to return MCP server configuration.

#### Scenario: Feishu adapter provides MCP config
- **WHEN** a Feishu Bitable adapter's `getMcpServerConfig(issueId)` is called
- **THEN** it SHALL return a config with `tracker_tool` backed by the generic implementation

#### Scenario: GitLab adapter provides MCP config
- **WHEN** a GitLab Issues adapter's `getMcpServerConfig(issueId)` is called
- **THEN** it SHALL return a config with `tracker_tool` backed by the generic implementation

### Requirement: Worker uses adapter interface for MCP
The `WorkerRunner` SHALL obtain MCP server configuration exclusively through `tracker.getMcpServerConfig(issueId)`, without any `instanceof` checks.

#### Scenario: MCP config via adapter
- **WHEN** a worker starts for issue SYM-001
- **THEN** `worker-runner` SHALL call `this.deps.tracker.getMcpServerConfig("SYM-001")` to get MCP servers
- **AND** pass those MCP servers to the agent configuration

#### Scenario: Tracker guidance is generic
- **WHEN** MCP servers are provided by the adapter
- **THEN** the tracker guidance prompt SHALL describe `tracker_tool` generically without mentioning "Feishu Bitable"

### Requirement: TrackerAdapter interface extension
The `TrackerAdapter` interface SHALL be extended with two new required methods: `createIssue` and `searchIssues`.

#### Scenario: createIssue signature
- **WHEN** a tracker adapter is implemented
- **THEN** it SHALL provide `createIssue(data: { title: string; description?: string; state?: string; labels?: string[] }): Promise<Issue>`

#### Scenario: searchIssues signature
- **WHEN** a tracker adapter is implemented
- **THEN** it SHALL provide `searchIssues(query: string): Promise<Issue[]>`

### Requirement: Adapter health check interface
The `TrackerAdapter` interface SHALL include an optional `healthCheck()` method that returns connectivity and permission diagnostics.

#### Scenario: Health check return type
- **WHEN** `adapter.healthCheck()` is called
- **THEN** it SHALL return `Promise<HealthCheckResult[]>` where each result has `{ name: string; status: "pass" | "fail"; message?: string }`

#### Scenario: Adapter without health check
- **WHEN** an adapter does not implement `healthCheck()`
- **THEN** the doctor command SHALL skip tracker-specific checks and log a debug message
