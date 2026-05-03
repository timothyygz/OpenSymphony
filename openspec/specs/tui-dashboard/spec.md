## ADDED Requirements

### Requirement: Dashboard renders orchestrator state to terminal
Dashboard SHALL periodically poll `Orchestrator.getState()` and render a formatted status panel to the terminal using ANSI escape codes. The refresh interval SHALL default to 1000ms and be configurable via `SYMPHONY_TUI_REFRESH_MS` environment variable.

#### Scenario: Dashboard displays with running agents
- **WHEN** the dashboard is active and 2 agents are running
- **THEN** a bordered panel is rendered showing header (agents count, throughput, runtime, tokens, rate limits, next refresh), a running agents table with 2 rows, and a backoff queue section

#### Scenario: Dashboard displays with no running agents
- **WHEN** the dashboard is active and no agents are running
- **THEN** the running section SHALL display "No active agents" and the backoff section SHALL display "No queued retries"

### Requirement: Dashboard uses alternate screen buffer
Dashboard SHALL enter alternate screen mode on start (`\x1b[?1049h`) and restore the original screen on exit (`\x1b[?1049l`). This preserves the user's terminal history.

#### Scenario: Terminal history preserved after exit
- **WHEN** the dashboard starts, renders content, then stops
- **THEN** the user's terminal scrollback buffer is intact and the dashboard output is not visible

### Requirement: Smart re-rendering with state fingerprint
Dashboard SHALL compute a fingerprint of the orchestrator state before each render cycle. It SHALL skip rendering if the fingerprint is unchanged, unless a periodic idle rerender timer (minimum 1000ms) has elapsed.

#### Scenario: No re-render when state unchanged
- **WHEN** the orchestrator state has not changed since last render and the idle timer has not elapsed
- **THEN** no terminal output is written

#### Scenario: Force rerender on idle timer
- **WHEN** the orchestrator state has not changed but the idle rerender timer has elapsed
- **THEN** the dashboard SHALL re-render to update countdown values (e.g., "Next refresh")

### Requirement: Header section displays overview metrics
The header section SHALL display: Agents count (active/max + completed count), throughput (tps with sparkline), runtime, token usage (input/output/total), rate limits, and next refresh countdown. Rate limits SHALL be displayed defensively: if `state.rateLimits` is `unknown` or does not match the expected structure, the header SHALL display "N/A".

#### Scenario: Header shows all metrics
- **WHEN** the dashboard renders with active agents
- **THEN** the header displays all 7 metrics: Agents, Completed, Throughput, Runtime, Tokens, Rate Limits, Next refresh

#### Scenario: Next refresh countdown
- **WHEN** `state.nextTickAt` is a valid timestamp
- **THEN** the header displays the countdown in seconds (e.g., "Next refresh: 5s")

#### Scenario: Next refresh unavailable
- **WHEN** `state.nextTickAt` is null
- **THEN** the header displays "Next refresh: n/a"

#### Scenario: Tick in progress
- **WHEN** `state.nextTickAt` is a valid timestamp but less than `Date.now()` (tick is executing)
- **THEN** the header displays "Next refresh: refreshing..."

### Requirement: Running agents table with 6 columns
The running agents table SHALL display columns: ID (identifier), TITLE (issue title truncated), STATE (issue state), AGE/TURN (runtime + turn count), TOKENS (total token count), EVENT (humanized last event). EVENT column width SHALL adapt dynamically to terminal width.

#### Scenario: Running table with multiple agents
- **WHEN** 3 agents are running with different states
- **THEN** the table shows 3 data rows with all 6 columns, sorted by identifier

#### Scenario: TITLE column truncates long titles
- **WHEN** an issue title exceeds the TITLE column width
- **THEN** the title is truncated with "..." suffix

### Requirement: CJK character width handling
All column alignment functions SHALL account for CJK (Chinese/Japanese/Korean) full-width characters, which occupy 2 terminal columns. The `displayWidth()` function SHALL correctly measure strings containing CJK characters.

#### Scenario: Chinese state values align correctly
- **WHEN** an issue state is "进行中" (3 CJK characters = 6 columns wide)
- **THEN** the STATE column is correctly padded to align with other rows

### Requirement: Status dot colors by event type
Each running agent row SHALL display a colored status dot (●) based on the last event type. Colors: green for active generation, cyan for streaming, magenta for completion, yellow for tool calls, red for no event.

#### Scenario: Agent with result event
- **WHEN** an agent's last event is "result"
- **THEN** the status dot is magenta and the EVENT column shows "turn completed" in magenta

### Requirement: Claude Code event humanization
The dashboard SHALL map Claude Code `stream-json` event types to human-readable labels. Unrecognized events SHALL display the raw event name.

#### Scenario: Known event mapping
- **WHEN** last event is "content_block_delta"
- **THEN** the EVENT column displays "streaming output"

#### Scenario: Unknown event fallback
- **WHEN** last event is "custom_event_xyz"
- **THEN** the EVENT column displays "custom_event_xyz"

### Requirement: Throughput sparkline graph
The dashboard SHALL display a sparkline graph (▁▂▃▄▅▆▇█) showing token throughput over a rolling 10-minute window with 24 columns. TPS (tokens per second) SHALL be calculated from rolling token samples. The sparkline module SHALL maintain an internal ring buffer of token samples, sampling from `state.aggregateTotals.totalTokens` each refresh cycle and computing delta. The 10-minute window (600 samples at 1s interval) SHALL be downsampled to 24 buckets for rendering.

#### Scenario: Sparkline renders with data
- **WHEN** token samples exist over the last 10 minutes
- **THEN** a 24-character sparkline is rendered next to the TPS value

#### Scenario: Sparkline with no data
- **WHEN** no token samples exist
- **THEN** the sparkline displays all ▁ (minimum) blocks and TPS shows "0"

### Requirement: Backoff queue display
The backoff section SHALL list all pending retries with identifier, attempt number, countdown to retry, and error message. Empty queue SHALL show "No queued retries".

#### Scenario: Multiple retries queued
- **WHEN** 2 issues are in the retry queue
- **THEN** each is shown with ↻ symbol, identifier, attempt number, countdown, and truncated error

#### Scenario: Retry countdown
- **WHEN** a retry entry has `dueAtMs` in the future
- **THEN** the countdown shows seconds remaining (e.g., "in 15.000s")

### Requirement: Terminal width adaptation and resize handling
Dashboard SHALL detect terminal width via `process.stdout.columns` and adapt column widths accordingly. It SHALL listen for `process.stdout` `'resize'` events to trigger immediate re-render on terminal resize. The resize listener SHALL be removed on dashboard stop.

#### Scenario: Narrow terminal
- **WHEN** terminal width is 80 columns
- **THEN** the EVENT column shrinks to fit, minimum 12 characters

### Requirement: Non-TTY and dumb terminal fallback
Dashboard SHALL detect if stdout is not a TTY or if `TERM=dumb`, and skip alternate screen and rendering entirely, falling back to headless mode behavior.

#### Scenario: Piped output
- **WHEN** stdout is piped (e.g., `bun run src/cli.ts | tee log.txt`)
- **THEN** the dashboard does not attempt alternate screen or ANSI rendering

#### Scenario: Dumb terminal
- **WHEN** `process.env.TERM === "dumb"`
- **THEN** the dashboard does not attempt alternate screen or ANSI rendering
