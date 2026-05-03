## Why

The TUI dashboard only displays token totals from the current session (in-memory `aggregateTotals`). When the process restarts, all historical data is lost from the UI. The raw data already persists in `.symphony-tokens.jsonl` with `completedAt` timestamps, but there is no way to view aggregated trends over time — making it impossible to track daily burn rate, weekly patterns, or monthly costs.

## What Changes

- Add a `MetricsAggregator` that reads `.symphony-tokens.jsonl` and groups records by day, week (ISO week), and month — returning pre-computed summaries (inputTokens, outputTokens, totalTokens, issueCount per bucket).
- Add a new TUI section ("History") between the header and the running table that shows token usage for Today / This Week / This Month with issue count per period.
- Extend `TokenLog` with a `query(period)` method that feeds the aggregator with filtered records.

## Capabilities

### New Capabilities
- `token-metrics-aggregation`: Time-bucketed aggregation of token usage records from the JSONL log, supporting daily, weekly, and monthly periods.
- `tui-history-section`: A new TUI dashboard section that renders historical token usage statistics (today / this week / this month).

### Modified Capabilities
- `tui-dashboard`: Add the history section to the dashboard layout, between the header and the running agents table.

## Impact

- `src/metrics/token-log.ts` — new `query()` method with time-based filtering
- `src/metrics/aggregator.ts` — new file for time-bucketed aggregation
- `src/tui/layout.ts` — new `formatHistory()` section
- `src/tui/dashboard.ts` — wire aggregator into dashboard render cycle, control refresh cadence for historical data (not every 1s)
- No new dependencies; uses existing `Bun.file()` and `Date` APIs
