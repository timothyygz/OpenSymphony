## ADDED Requirements

### Requirement: Interactive init wizard
The system SHALL provide a `symphony init [path]` command that launches an interactive wizard to generate a WORKFLOW.md file. The wizard SHALL use `@clack/prompts` for all user interaction. The wizard SHALL first prompt the user to select a tracker type before proceeding with tracker-specific setup.

#### Scenario: Basic wizard flow
- **WHEN** user runs `symphony init`
- **THEN** the wizard sequentially collects: tracker type selection, tracker config (via tracker-specific setup), agent config, workspace config, prompt template, credential storage preference
- **AND** writes a valid WORKFLOW.md to the current directory

#### Scenario: Tracker type selection
- **WHEN** user reaches the tracker step
- **THEN** the wizard SHALL display available tracker kinds from the registry (e.g. "feishu_bitable", "gitlab_issues")
- **AND** prompt the user to select one

#### Scenario: Tracker-specific setup routing
- **WHEN** user selects a tracker kind
- **THEN** the wizard SHALL call the tracker's registered setup function
- **AND** the setup function SHALL handle all tracker-specific configuration and return a config object

#### Scenario: Custom output path
- **WHEN** user runs `symphony init /path/to/config`
- **THEN** the wizard writes WORKFLOW.md to the specified path

#### Scenario: Existing WORKFLOW.md
- **WHEN** target path already contains a WORKFLOW.md
- **THEN** the wizard SHALL warn the user and prompt to overwrite or cancel

### Requirement: Feishu Bitable tracker setup
The wizard SHALL guide users through configuring a Feishu Bitable tracker. Users SHALL only need to provide `app_id` and `app_secret`. The wizard SHALL auto-create a compliant Bitable table.

#### Scenario: Auto-create Bitable table
- **WHEN** user selects `feishu_bitable` and provides valid app_id and app_secret
- **THEN** the wizard authenticates with Feishu, creates a new Bitable App, creates a table with 10 standard fields (编号/AutoNumber, 标题/Text, 状态/SingleSelect, 描述/Text, 优先级/SingleSelect, 标签/MultiSelect, tokens消耗/Number, 进度/Number+Progress, 结果摘要/Text, 操作命令/Text), deletes the default empty table, and returns the app_token, table_id, and Bitable URL

#### Scenario: Invalid credentials
- **WHEN** user provides invalid app_id or app_secret
- **THEN** the wizard SHALL display an error message and allow retry without restarting

#### Scenario: Connection test
- **WHEN** credentials are provided
- **THEN** the wizard SHALL test connectivity by calling the Feishu auth API before proceeding to table creation

#### Scenario: State name customization
- **WHEN** the Bitable table is created
- **THEN** the wizard SHALL prompt for active_states and terminal_states with sensible defaults (active: ["待处理","进行中"], terminal: ["已完成","已取消","已关闭"])

### Requirement: Bitable ownership transfer
After creating the Bitable, the wizard SHALL offer to transfer ownership to the user so they can manage the table in Feishu.

#### Scenario: Transfer ownership via phone number
- **WHEN** the Bitable table is created successfully
- **THEN** the wizard SHALL prompt the user for their phone number
- **AND** look up the user's `open_id` via `POST /open-apis/contact/v3/users/batch_get_id`
- **AND** transfer ownership via `POST /open-apis/drive/v1/permissions/{app_token}/members/transfer_owner?type=bitable`
- **AND** the robot SHALL retain `full_access` permission (default behavior)

#### Scenario: Phone number format
- **WHEN** the user enters their phone number
- **THEN** Chinese mainland numbers SHALL be entered as 11 digits (e.g. 13800138000)
- **AND** international numbers SHALL include country code prefix (e.g. +1-5551234567)

#### Scenario: User lookup failure
- **WHEN** the phone number lookup fails (user not found, API error, or missing `contact:user.id:readonly` permission)
- **THEN** the wizard SHALL display the error and offer to skip the transfer step
- **AND** inform the user they can manually add permissions in the Feishu Bitable UI

#### Scenario: Ownership transfer failure
- **WHEN** the transfer API call fails
- **THEN** the wizard SHALL display the error and offer to skip
- **AND** inform the user they can manually request ownership transfer later

#### Scenario: Skip ownership transfer
- **WHEN** the user chooses to skip or presses cancel on the phone number prompt
- **THEN** the wizard SHALL proceed with the rest of the setup without ownership transfer
- **AND** display a hint that the user needs to manually add themselves as a collaborator in the Bitable

### Requirement: Agent setup
The wizard SHALL configure the claude-code agent. Agent selection is automatic (no user choice needed).

#### Scenario: Agent configuration
- **WHEN** user reaches the agent step
- **THEN** the wizard SHALL automatically use claude-code agent kind

#### Scenario: Claude CLI availability check
- **WHEN** the agent step begins
- **THEN** the wizard SHALL check if `claude` CLI is available via `which claude` and warn if not found

#### Scenario: Agent parameter collection
- **WHEN** the agent step runs
- **THEN** the wizard SHALL prompt for max_concurrent_agents (default 5), max_turns (default 20), and approval_policy (default "auto")

### Requirement: Workspace setup
The wizard SHALL prompt for workspace configuration including source type and root directory. Only a single workspace source is supported.

#### Scenario: Workspace source selection
- **WHEN** user reaches the workspace step
- **THEN** the wizard SHALL offer source types: git-worktree, git-clone, none
- **AND** for git-worktree, prompt for repo path
- **AND** for git-clone, prompt for url, path, branch

#### Scenario: Default workspace root
- **WHEN** user accepts defaults
- **THEN** workspace root SHALL be `~/.open-symphony/workspaces`

### Requirement: Prompt template selection
The wizard SHALL offer preset prompt templates using Liquid syntax (compatible with `liquidjs` engine).

#### Scenario: Preset selection
- **WHEN** user reaches the template step
- **THEN** the wizard SHALL display 3 presets: basic (English), Chinese (中文指引), empty (framework only)
- **AND** show a preview of the selected template

### Requirement: Credential storage preference
The wizard SHALL let users choose where to store credentials.

#### Scenario: Inline storage
- **WHEN** user chooses inline
- **THEN** credentials SHALL be written directly into WORKFLOW.md YAML front matter

#### Scenario: Global settings storage
- **WHEN** user chooses global settings
- **THEN** credentials SHALL be written to `~/.open-symphony/settings.json` and WORKFLOW.md SHALL omit credential fields

#### Scenario: Environment variable storage
- **WHEN** user chooses env vars
- **THEN** WORKFLOW.md SHALL use `$FEISHU_APP_ID` / `$FEISHU_APP_SECRET` syntax and the wizard SHALL display instructions for setting the variables

### Requirement: Config preview and confirmation
The wizard SHALL show a preview of the generated WORKFLOW.md before writing.

#### Scenario: Preview and confirm
- **WHEN** all steps are complete
- **THEN** the wizard SHALL display the full WORKFLOW.md content and ask for confirmation before writing

#### Scenario: Reject preview
- **WHEN** user rejects the preview
- **THEN** the wizard SHALL inform the user to re-run `symphony init` to start over and exit

### Requirement: Generated config validation
The generated WORKFLOW.md SHALL pass `validateDispatchConfig()` validation.

#### Scenario: Valid output
- **WHEN** WORKFLOW.md is written
- **THEN** loading it with `loadWorkflow()` + `buildServiceConfig()` SHALL produce a valid ServiceConfig with no validation errors

### Requirement: GitLab Issues tracker setup
The wizard SHALL guide users through configuring a GitLab Issues tracker when `gitlab_issues` is selected.

#### Scenario: GitLab credential collection
- **WHEN** user selects `gitlab_issues`
- **THEN** the wizard SHALL prompt for `gitlab_host` (default `https://gitlab.com`), `gitlab_token` (PAT), and `project_id`

#### Scenario: GitLab connectivity test
- **WHEN** credentials are provided
- **THEN** the wizard SHALL test connectivity by calling `GET /projects/:id` with the token
- **AND** display the project name on success

#### Scenario: Label creation
- **WHEN** the project is accessible
- **THEN** the wizard SHALL offer to auto-create scoped labels (`symphony::Todo`, `symphony::In Progress`, etc.) in the project
- **AND** prompt for active_states and terminal_states with sensible defaults

#### Scenario: Invalid token
- **WHEN** the PAT is invalid or lacks `api` scope
- **THEN** the wizard SHALL display an error and allow retry
