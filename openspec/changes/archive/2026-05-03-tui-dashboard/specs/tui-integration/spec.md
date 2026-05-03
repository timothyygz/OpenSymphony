## ADDED Requirements

### Requirement: CLI --no-tui flag
The CLI SHALL accept a `--no-tui` flag that disables the terminal dashboard and runs in headless mode (Pino JSON to stdout). The flag SHALL be parsed alongside the positional workflow path argument in any order.

#### Scenario: Default mode starts TUI
- **WHEN** `bun run src/cli.ts` is executed without flags and stdout is a TTY
- **THEN** the terminal dashboard is displayed

#### Scenario: --no-tui flag disables TUI
- **WHEN** `bun run src/cli.ts --no-tui` is executed
- **THEN** the service runs as a headless daemon with JSON logs to stdout

#### Scenario: --no-tui with workflow path
- **WHEN** `bun run src/cli.ts --no-tui path/to/WORKFLOW.md` is executed
- **THEN** the service runs in headless mode using the specified workflow path

#### Scenario: TERM=dumb disables TUI
- **WHEN** `process.env.TERM === "dumb"` is set
- **THEN** the service runs in headless mode regardless of other flags

### Requirement: Log redirection in TUI mode
When TUI mode is active, Pino SHALL output to stderr. When headless mode is active, Pino SHALL output to stdout (default behavior).

#### Scenario: TUI mode log output
- **WHEN** the dashboard is running
- **THEN** Pino JSON logs are written to stderr and do not corrupt the dashboard display

#### Scenario: Headless mode log output
- **WHEN** `--no-tui` is specified
- **THEN** Pino JSON logs are written to stdout as before

### Requirement: Logger lazy initialization via Proxy
The logger module SHALL export a Proxy-wrapped pino instance that defers actual logger creation until first method call. This ensures `SYMPHONY_LOG_DEST` is read at call time, not at module import time. All existing `import { logger }` usage SHALL continue to work without modification.

#### Scenario: Logger creates with stderr destination in TUI mode
- **WHEN** TUI mode is active and `process.env.SYMPHONY_LOG_DEST` is "stderr"
- **THEN** the pino instance is created with `pino.destination(2)` on first `logger.info()` call

#### Scenario: Logger creates with default stdout in headless mode
- **WHEN** headless mode is active and `SYMPHONY_LOG_DEST` is not set
- **THEN** the pino instance is created with default stdout destination

### Requirement: OrchestratorState nextTickAt field
`OrchestratorState` SHALL include a `nextTickAt: number | null` field. The orchestrator SHALL set this field to `Date.now() + pollIntervalMs` each time it schedules a tick.

#### Scenario: nextTickAt reflects next tick time
- **WHEN** the orchestrator schedules a tick with 30000ms interval
- **THEN** `state.nextTickAt` equals `Date.now() + 30000`

#### Scenario: nextTickAt before first tick
- **WHEN** the orchestrator has not yet scheduled any tick
- **THEN** `state.nextTickAt` is null

### Requirement: Dashboard lifecycle bound to orchestrator
The dashboard SHALL start after the orchestrator is created and stop before the orchestrator stops. On SIGINT/SIGTERM, the dashboard SHALL exit alternate screen before the process exits.

#### Scenario: Graceful shutdown restores terminal
- **WHEN** SIGINT is received while dashboard is running
- **THEN** alternate screen is exited, then orchestrator stops, then process exits with code 0
