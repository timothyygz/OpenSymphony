## ADDED Requirements

### Requirement: System diagnostic command
The system SHALL provide a `symphony doctor [path]` command that checks the health of the Symphony environment and reports issues.

#### Scenario: Full diagnostic run
- **WHEN** user runs `symphony doctor`
- **THEN** the system SHALL check all items and display a pass/fail summary for each

### Requirement: Claude CLI check
Doctor SHALL verify Claude Code CLI is available.

#### Scenario: Claude CLI pass
- **WHEN** `claude` command is found in PATH
- **THEN** doctor SHALL report PASS with version info

#### Scenario: Claude CLI fail
- **WHEN** `claude` command is not found
- **THEN** doctor SHALL report FAIL with installation instructions

### Requirement: WORKFLOW.md validation
Doctor SHALL verify the WORKFLOW.md file exists, parses correctly, and passes config validation.

#### Scenario: Valid WORKFLOW.md
- **WHEN** WORKFLOW.md exists, YAML front matter parses, and `validateDispatchConfig()` returns null
- **THEN** doctor SHALL report PASS

#### Scenario: Missing WORKFLOW.md
- **WHEN** no WORKFLOW.md found
- **THEN** doctor SHALL report FAIL with suggestion to run `symphony init`

#### Scenario: Invalid config
- **WHEN** WORKFLOW.md exists but validation fails
- **THEN** doctor SHALL report FAIL with the specific validation error message

### Requirement: Feishu connectivity check
Doctor SHALL test tracker API connectivity using configured credentials, routed by tracker `kind`. The check SHALL use the adapter's `healthCheck()` method when available.

#### Scenario: Adapter provides health check
- **WHEN** the configured tracker adapter implements `healthCheck()`
- **THEN** doctor SHALL call `adapter.healthCheck()` and report each result as pass/fail

#### Scenario: Adapter without health check
- **WHEN** the configured tracker adapter does not implement `healthCheck()`
- **THEN** doctor SHALL skip tracker-specific checks and report a warning

#### Scenario: Auth pass
- **WHEN** adapter health check returns pass for connectivity
- **THEN** doctor SHALL report PASS

#### Scenario: Auth fail
- **WHEN** adapter health check returns fail for connectivity
- **THEN** doctor SHALL report FAIL with credential verification instructions

#### Scenario: Bitable access pass
- **WHEN** adapter health check returns pass for resource access (app_token and table_id are valid and records can be listed)
- **THEN** doctor SHALL report PASS

#### Scenario: Bitable access fail
- **WHEN** adapter health check returns fail for resource access
- **THEN** doctor SHALL report FAIL with resource URL and permission check instructions

### Requirement: Workspace directory check
Doctor SHALL verify the workspace root directory is writable.

#### Scenario: Writable workspace
- **WHEN** workspace root directory exists and is writable
- **THEN** doctor SHALL report PASS

#### Scenario: Unwritable workspace
- **WHEN** workspace root cannot be created or is not writable
- **THEN** doctor SHALL report FAIL

### Requirement: Git availability check
Doctor SHALL verify Git is available when workspace sources require it.

#### Scenario: Git check
- **WHEN** workspace sources include git-clone or git-worktree
- **THEN** doctor SHALL verify `git` is available in PATH and report result

### Requirement: Doctor exit code
Doctor SHALL set a non-zero exit code when any check fails.

#### Scenario: All checks pass
- **WHEN** all checks pass
- **THEN** exit code SHALL be 0

#### Scenario: Any check fails
- **WHEN** one or more checks fail
- **THEN** exit code SHALL be 1
