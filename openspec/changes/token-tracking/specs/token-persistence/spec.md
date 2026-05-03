## ADDED Requirements

### Requirement: Token log appends record on all worker termination paths
The system SHALL append a JSON line to the token log file each time a worker is terminated, regardless of the termination path: `onWorkerExit` (normal/failed), `reconcileStalled`, or `reconcileTrackerStates`. Each record SHALL contain: `identifier` (issue 编号如 "SUDI-42"), `issueId` (飞书 record_id), `inputTokens`, `outputTokens`, `totalTokens`, `turns`, `retryAttempt`, `completedAt` (ISO timestamp).

#### Scenario: Normal exit writes record
- **WHEN** a worker completes successfully for issue "SUDI-42" with 1000 input tokens and 500 output tokens
- **THEN** a JSON line is appended with `identifier: "SUDI-42"`, `totalTokens: 1500`, and the current ISO timestamp

#### Scenario: Failed exit writes record
- **WHEN** a worker fails for issue "SUDI-43"
- **THEN** a JSON line is still appended with the token data consumed before failure

#### Scenario: Stalled worker writes record
- **WHEN** a worker is terminated by stall detection in `reconcileStalled`
- **THEN** a JSON line is appended with the token data consumed before stall was detected

#### Scenario: External state change writes record
- **WHEN** an issue's state is changed externally to terminal and `reconcileTrackerStates` terminates the worker
- **THEN** a JSON line is appended with the token data consumed before termination

### Requirement: Aggregate totals include all terminated workers
`state.aggregateTotals` SHALL accumulate token counts from all terminated workers across all three termination paths (`onWorkerExit`, `reconcileStalled`, `reconcileTrackerStates`). Token usage SHALL be added to `aggregateTotals` before deleting the running entry.

#### Scenario: Tokens accumulate after worker exit
- **WHEN** a worker with 1000 total tokens exits via `onWorkerExit`
- **THEN** `state.aggregateTotals.totalTokens` increases by 1000

#### Scenario: Tokens accumulate after stall termination
- **WHEN** a stalled worker with 500 total tokens is terminated via `reconcileStalled`
- **THEN** `state.aggregateTotals.totalTokens` increases by 500

#### Scenario: Tokens accumulate after external state change
- **WHEN** a worker with 800 total tokens is terminated via `reconcileTrackerStates`
- **THEN** `state.aggregateTotals.totalTokens` increases by 800

#### Scenario: Multiple paths accumulate correctly
- **WHEN** a worker exits normally (1000 tokens), a stalled worker is terminated (500 tokens), and an externally-changed worker is terminated (800 tokens)
- **THEN** `state.aggregateTotals.totalTokens` equals 2300

### Requirement: Token log file path defaults to workflow directory
The token log file path SHALL default to `<workflow-dir>/.symphony-tokens.jsonl`. The path SHALL be overridable via the `TokenLog` constructor.

#### Scenario: Default file path
- **WHEN** no path is specified and workflow is at `/app/WORKFLOW.md`
- **THEN** token records are written to `/app/.symphony-tokens.jsonl`

#### Scenario: Custom file path
- **WHEN** a custom path is provided
- **THEN** token records are written to the specified file

### Requirement: Token log summary skips corrupted lines
The `TokenLog.summary()` method SHALL skip lines that cannot be parsed as valid JSON and log a warning for each skipped line. It SHALL return aggregated totals from all successfully parsed lines.

#### Scenario: Corrupted last line is skipped
- **WHEN** the JSONL file has 10 valid lines and 1 corrupted trailing line
- **THEN** `summary()` returns totals from 10 valid lines and logs a warning for the corrupted line

### Requirement: AggregateTotals are session-scoped and not recovered
`aggregateTotals` SHALL represent the current process session only. On restart, `aggregateTotals` SHALL start from zero. The JSONL file is the persistent cross-session record.

#### Scenario: Fresh start after restart
- **WHEN** the orchestrator restarts
- **THEN** `aggregateTotals` is zero regardless of previous session data in JSONL
