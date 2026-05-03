## MODIFIED Requirements

### Requirement: Dashboard renders orchestrator state to terminal
Dashboard SHALL periodically poll `Orchestrator.getState()` and render a formatted status panel to the terminal using ANSI escape codes. The refresh interval SHALL default to 1000ms and be configurable via `SYMPHONY_TUI_REFRESH_MS` environment variable. The rendered layout SHALL include the following sections in order: header, history, running agents table, and backoff queue.

#### Scenario: Dashboard displays with running agents
- **WHEN** the dashboard is active and 2 agents are running
- **THEN** a bordered panel is rendered showing header (agents count, throughput, runtime, tokens, rate limits, next refresh), a history section (today/week/month token stats), a running agents table with 2 rows, and a backoff queue section

#### Scenario: Dashboard displays with no running agents
- **WHEN** the dashboard is active and no agents are running
- **THEN** the running section SHALL display "No active agents" and the backoff section SHALL display "No queued retries"

#### Scenario: History section positioned between header and running table
- **WHEN** the dashboard renders
- **THEN** the history section appears after the header block and before the running agents table
