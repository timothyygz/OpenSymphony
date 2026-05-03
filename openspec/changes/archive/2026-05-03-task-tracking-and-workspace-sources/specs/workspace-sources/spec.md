## ADDED Requirements

### Requirement: Git clone source type
The system SHALL support initializing a workspace subdirectory by cloning a remote Git repository. The source configuration SHALL include `type: "git-clone"`, `url` (remote URL), `path` (target subdirectory within workspace), and optional `branch` and `depth` (defaulting to 1).

#### Scenario: Clone from remote with defaults
- **WHEN** a source is configured as `{ type: "git-clone", url: "git@github.com:org/repo.git", path: "frontend" }`
- **THEN** the system executes `git clone --depth 1 git@github.com:org/repo.git <workspace>/frontend`

#### Scenario: Clone with explicit branch
- **WHEN** a source is configured with `branch: "develop"`
- **THEN** the system executes `git clone --depth 1 --branch develop <url> <workspace>/<path>`

#### Scenario: Clone with depth disabled
- **WHEN** a source is configured with `depth: 0`
- **THEN** the system executes `git clone --branch <branch> <url> <workspace>/<path>` without `--depth`

### Requirement: Git worktree source type
The system SHALL support initializing a workspace subdirectory by creating a Git worktree from a local repository. The source configuration SHALL include `type: "git-worktree"`, `repo` (local repository path), and optional `path` (defaults to repository directory name) and `branch`.

#### Scenario: Worktree from local repo
- **WHEN** a source is configured as `{ type: "git-worktree", repo: "~/Workspace/frontend" }`
- **THEN** the system executes `git -C ~/Workspace/frontend worktree add <workspace>/frontend --detach HEAD`

#### Scenario: Worktree with explicit branch
- **WHEN** a source is configured with `branch: "feature-x"`
- **THEN** the system creates a new branch `feature-x` from HEAD and adds the worktree on that branch

#### Scenario: Worktree path defaults to repo name
- **WHEN** a source is configured as `{ type: "git-worktree", repo: "/home/user/my-project" }` without `path`
- **THEN** the worktree is created at `<workspace>/my-project`

### Requirement: Multiple sources
The system SHALL support configuring multiple sources that are initialized in order. Sources of different types (git-clone and git-worktree) MAY be mixed in the same workspace configuration.

#### Scenario: Mixed sources
- **WHEN** workspace.sources is configured with two sources: a git-worktree for "frontend" and a git-clone for "backend"
- **THEN** the system first creates the worktree for frontend, then clones the backend repository

#### Scenario: Source failure stops initialization
- **WHEN** the first source fails (e.g., clone error)
- **THEN** the system aborts remaining sources and the workspace creation fails

#### Scenario: Partial source failure triggers rollback
- **WHEN** the first of three sources succeeds but the second fails
- **THEN** the system rolls back the first source (worktree → `git worktree remove`, clone → `rm -rf`), then removes the workspace directory and reports the failure

### Requirement: Source initialization timing
The system SHALL initialize sources after creating the workspace directory but before running the `after_create` hook. Sources SHALL only be initialized when the workspace is newly created (`createdNow = true`), not when reusing an existing workspace.

#### Scenario: New workspace initializes sources
- **WHEN** a workspace is created for the first time and sources are configured
- **THEN** sources are initialized, then the `after_create` hook runs

#### Scenario: Reused workspace skips sources
- **WHEN** a workspace already exists from a previous run
- **THEN** sources are NOT re-initialized (workspace directory and code are reused as-is)

#### Scenario: Sources config mismatch on reuse
- **WHEN** a workspace is reused but the current sources config hash differs from the one stored in `.symphony/meta.json`
- **THEN** the system logs a warning indicating the sources configuration has changed since workspace creation

### Requirement: Worktree-aware cleanup
The system SHALL clean up worktree-type sources by calling `git -C <repo> worktree remove <workspace>/<path>` before removing the workspace directory. Clone-type sources are removed along with the workspace directory via `rm -rf`.

#### Scenario: Worktree cleanup removes reference
- **WHEN** cleanupWorkspace is called for a workspace that was initialized with a git-worktree source pointing to `~/Workspace/frontend`
- **THEN** the system runs `git -C ~/Workspace/frontend worktree remove <workspace>/frontend` before `rm -rf <workspace>`

#### Scenario: Clone cleanup is standard removal
- **WHEN** cleanupWorkspace is called for a workspace that only has git-clone sources
- **THEN** the workspace directory is removed with `rm -rf` without any special git commands

#### Scenario: Worktree cleanup failure is non-blocking
- **WHEN** `git worktree remove` fails (e.g., uncommitted changes)
- **THEN** the system logs a warning and proceeds with `rm -rf` as a fallback

### Requirement: Workspace sources schema
The `workspace.sources` configuration SHALL be validated at config load time. Invalid source configurations (missing required fields, unknown type) SHALL produce a validation error that prevents the orchestrator from starting.

#### Scenario: Missing url for git-clone
- **WHEN** a source has `type: "git-clone"` but no `url` field
- **THEN** config validation fails with an error message indicating the missing field

#### Scenario: Missing repo for git-worktree
- **WHEN** a source has `type: "git-worktree"` but no `repo` field
- **THEN** config validation fails with an error message indicating the missing field

#### Scenario: Unknown source type
- **WHEN** a source has `type: "svn"`
- **THEN** config validation fails with an error indicating the unsupported type
