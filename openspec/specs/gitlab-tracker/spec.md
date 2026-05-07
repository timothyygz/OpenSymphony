## ADDED Requirements

### Requirement: GitLab Issues tracker adapter
The system SHALL provide a `gitlab_issues` tracker adapter that implements the `TrackerAdapter` interface and communicates with GitLab via REST API.

#### Scenario: Adapter registration
- **WHEN** the `gitlab_issues` register module is imported
- **THEN** the adapter SHALL be registered under kind `"gitlab_issues"` in the tracker registry

#### Scenario: Configuration fields
- **WHEN** a user configures tracker kind as `gitlab_issues`
- **THEN** the required config fields SHALL be `gitlab_host` (default `https://gitlab.com`), `gitlab_token`, `project_id`
- **AND** optional fields SHALL be `active_states`, `terminal_states`, `labels_field` (default `symphony`)

### Requirement: GitLab authentication
The GitLab adapter SHALL authenticate using a Personal Access Token via the `PRIVATE-TOKEN` header.

#### Scenario: Successful authentication
- **WHEN** a valid `gitlab_token` and `gitlab_host` are configured
- **THEN** all API requests SHALL include `PRIVATE-TOKEN: <token>` header

#### Scenario: Invalid token
- **WHEN** the token is invalid or expired
- **THEN** API calls SHALL throw a descriptive error indicating authentication failure

### Requirement: Label-based state management
The GitLab adapter SHALL map issue states to scoped labels with prefix `symphony::`.

#### Scenario: Fetch candidate issues
- **WHEN** `fetchCandidateIssues()` is called with active states `["symphony::Todo", "symphony::In Progress"]`
- **THEN** the adapter SHALL call `GET /projects/:id/issues?labels=symphony::Todo,symphony::In Progress&state=opened`
- **AND** map results to the `Issue` domain model

#### Scenario: Fetch issues by states
- **WHEN** `fetchIssuesByStates(["symphony::Done"])` is called
- **THEN** the adapter SHALL call `GET /projects/:id/issues?labels=symphony::Done&state=opened`

#### Scenario: Update issue state
- **WHEN** `updateIssueState(iid, "symphony::In Progress")` is called
- **THEN** the adapter SHALL call `PUT /projects/:id/issues/:iid` with labels that replace the current `symphony::*` label with `symphony::In Progress`
- **AND** preserve all non-symphony labels on the issue

#### Scenario: Fetch issue states by IDs
- **WHEN** `fetchIssueStatesByIds(["42", "43"])` is called
- **THEN** the adapter SHALL fetch each issue and extract the `symphony::*` label as the state

### Requirement: GitLab issue mapping
The adapter SHALL map GitLab Issue API responses to the `Issue` domain model.

#### Scenario: Field mapping
- **WHEN** a GitLab issue response is received
- **THEN** `id` SHALL map to `issue.iid` (stringified)
- **AND** `identifier` SHALL map to `issue.references.short` (e.g. "foo/bar#42")
- **AND** `title` SHALL map to `issue.title`
- **AND** `description` SHALL map to `issue.description`
- **AND** `state` SHALL map to the `symphony::*` scoped label value, falling back to `issue.state` (open/closed)
- **AND** `priority` SHALL map to `issue.weight` or null
- **AND** `labels` SHALL map to all non-symphony labels
- **AND** `url` SHALL map to `issue.web_url`
- **AND** `createdAt` SHALL map to `issue.created_at`
- **AND** `updatedAt` SHALL map to `issue.updated_at`
- **AND** `branchName` SHALL be null
- **AND** `blockedBy` SHALL be an empty array

### Requirement: GitLab create issue
The adapter SHALL implement `createIssue(data)` to create a new GitLab issue.

#### Scenario: Create with state label
- **WHEN** `createIssue({ title: "Fix bug", description: "...", state: "symphony::Todo" })` is called
- **THEN** the adapter SHALL call `POST /projects/:id/issues` with the title, description, and labels including `symphony::Todo`

### Requirement: GitLab search issues
The adapter SHALL implement `searchIssues(query)` to search issues by text.

#### Scenario: Text search
- **WHEN** `searchIssues("login bug")` is called
- **THEN** the adapter SHALL call `GET /projects/:id/issues?search=login+bug`
- **AND** return mapped `Issue[]`

### Requirement: GitLab token usage update
The adapter SHALL implement `updateIssueTokens` by storing token data in the issue description as a metadata block.

#### Scenario: Write token data
- **WHEN** `updateIssueTokens(iid, tokens)` is called
- **THEN** the adapter SHALL append or update a `<!-- symphony-tokens: {...} -->` HTML comment in the issue description

### Requirement: GitLab health check
The adapter SHALL implement `healthCheck()` returning connectivity and permission checks.

#### Scenario: Successful health check
- **WHEN** `healthCheck()` is called with valid credentials
- **THEN** the adapter SHALL return PASS for GitLab API connectivity and project access

#### Scenario: Failed connectivity
- **WHEN** `healthCheck()` is called with unreachable host
- **THEN** the adapter SHALL return FAIL with connection error details

#### Scenario: Insufficient permissions
- **WHEN** the token lacks `api` scope
- **THEN** the adapter SHALL return FAIL indicating the required scope
