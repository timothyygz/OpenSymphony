## Context

OpenSymphony persists completed worker token records to `.symphony-tokens.jsonl` (one JSON object per line with `completedAt` ISO timestamp). The TUI dashboard currently renders only the in-memory `aggregateTotals` from the current process session. There is no way to see how many tokens were consumed today, this week, or this month across restarts.

The JSONL file is append-only and typically small (hundreds of lines). The aggregator can read it efficiently on a low-frequency cadence.

## Goals / Non-Goals

**Goals:**
- Aggregate token records by three time periods: day, ISO week, calendar month
- Display today / this week / this month stats in the TUI dashboard
- Keep the aggregator decoupled from the TUI refresh cycle (historical data changes slowly)

**Non-Goals:**
- Persistent database (SQLite, etc.) — JSONL is sufficient for current scale
- Configurable time ranges or arbitrary period queries
- Per-agent or per-issue historical breakdown in the TUI
- Exporting historical data to external systems
- Caching the aggregated result to disk (recomputed on each dashboard refresh is fine for the file sizes involved)

## Decisions

### 1. Aggregator reads JSONL directly, no intermediate store

**Decision**: The `MetricsAggregator` reads `.symphony-tokens.jsonl` on each invocation, filters by time range, and sums in-memory.

**Why**: The JSONL file is append-only and typically < 1000 lines. Reading + parsing takes < 5ms. No need for a pre-computed cache, materialized view, or database. This avoids state management complexity and cache invalidation.

**Alternative considered**: Maintain a running SQLite database with aggregated buckets. Rejected because it adds a dependency and migration burden for negligible performance gain at current scale.

### 2. Aggregator runs on a separate cadence (every 30s), not every TUI tick

**Decision**: The dashboard queries the aggregator at a 30-second interval, not the 1-second TUI refresh rate. The aggregator result is cached between refreshes.

**Why**: Historical data only changes when a worker completes (~minutes apart). Reading the JSONL file every second would be wasteful. A 30-second cadence provides timely updates without I/O overhead.

### 3. Time buckets use local timezone

**Decision**: Day/week/month boundaries use the system's local timezone (`new Date()` with local interpretation).

**Why**: Users think in their local time. ISO weeks (Monday start) and calendar months follow natural expectations.

### 4. New TUI section inserted between header and running table

**Decision**: Add a `formatHistory()` layout function that renders a compact 2-line block:

```
├─ History
│ Today: 12,345 tokens (3 issues) │ Week: 98,765 tokens (15 issues) │ Month: 234,567 tokens (42 issues)
```

**Why**: Fits naturally in the existing layout flow. Compact format keeps the dashboard small. Color-coded period labels (cyan for today, magenta for week, yellow for month) maintain visual consistency.

## Risks / Trade-offs

- **JSONL file growth**: Over months the file could grow to tens of thousands of lines → Mitigation: at current scale this is still < 10ms to read. A future change can add rotation or compaction if needed.
- **Read I/O on every aggregator refresh**: Reading the full file every 30s → Mitigation: Bun's `Bun.file().text()` is fast for small files. The 30s cadence amortizes the cost.
- **Timezone-dependent grouping**: Results differ across machines in different timezones → Acceptable for a single-user CLI tool. Could add explicit TZ config in a future change.
