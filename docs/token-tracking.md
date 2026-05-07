# Token Tracking Chain

Token usage data flows from the Claude Agent SDK through delta deduplication, in-memory accumulation, and persistence, finally displayed in the TUI dashboard.

## End-to-End Flow

```
Claude Agent SDK (SDKResultMessage.usage)
    ↓
① SDK Extraction — src/adapters/agent/claude-code/adapter.ts:54-85
   extractUsageFromResult() reads input_tokens / output_tokens from SDK result
    ↓
② Delta Deduplication — src/orchestrator/event-processor.ts:49-74
   trackTokenDeltas() computes incremental delta against lastReportedTokenUsage,
   preventing double-counting when SDK reports cumulative values
    ↓
③ In-Memory Accumulation — src/orchestrator/state.ts:53-57
   Aggregates into RunningEntry.tokenUsage (per-worker) and
   OrchestratorState.aggregateTotals (session-level total)
    ↓
④ Finalization on Worker Exit — src/orchestrator/reconciler.ts:131-167
   finalizeWorkerTokens() performs three actions simultaneously:
   ├→ TokenStore.append() → SQLite persistence (~/.open-symphony/symphony.db)
   ├→ TrackerAdapter.updateIssueTokens() → write back to external tracker (Feishu/GitLab)
   └→ addTokenUsage() → accumulate into session aggregateTotals
    ↓
⑤ TUI Display — src/tui/dashboard.ts → src/tui/layout.ts
   ├ Header: "Tokens: in X | out Y | total Z" + sparkline TPS graph
   ├ History: Today / Week / Month stats (aggregated from SQLite)
   └ Running Table: per-worker token consumption
```

## Auxiliary Recording Points

| Point | File | What It Records |
|-------|------|-----------------|
| meta.json | `src/orchestrator/worker-runner.ts:259-265` | `totalTokens` + `totalTurns` written to `<workspace>/.symphony/meta.json` after each turn |
| Execution log | `src/logging/execution-log.ts:42-58` | `TurnCompletedEvent` and `WorkerExitEvent` include token data, written as JSONL to `<logDir>/.symphony-execution.jsonl` |

## Core Data Types

Defined in `src/model/session.ts`:

| Type | Lines | Purpose |
|------|-------|---------|
| `TokenUsage` | 3-7 | Base: `{ inputTokens, outputTokens, totalTokens }` |
| `RunningEntry` | 29-42 | Per-worker state with `tokenUsage` and `lastReportedTokenUsage` for delta tracking |
| `AggregateTotals` | 44-49 | Session-wide accumulated totals |
| `PeriodStats` | 51-56 | History display: tokens + issue count per period |
| `HistoryStats` | 58-62 | Container: `{ today, week, month }` each as `PeriodStats` |

## Persistence Layer

**SQLite** — `src/metrics/token-store.ts`

- Table: `token_records` with columns `id`, `identifier`, `issue_id`, `input_tokens`, `output_tokens`, `total_tokens`, `turns`, `retry_attempt`, `completed_at`
- Instantiated in `src/cli.ts:169-173` at `~/.open-symphony/symphony.db` with WAL mode
- `append(record)` inserts a row per completed worker
- `aggregate()` returns `HistoryStats` with today/week/month period sums

## External Tracker Updates

Both tracker adapters implement `updateIssueTokens()` from `src/adapters/tracker/types.ts`:

- **Feishu Bitable** (`src/adapters/tracker/feishu-bitable/adapter.ts:107-111`): writes `totalTokens` to a configurable column (`tokens_field` in workflow config)
- **GitLab Issues** (`src/adapters/tracker/gitlab-issues/adapter.ts:79-86`): appends an HTML comment `<!-- symphony-tokens: {...} -->` to the issue description

## TUI Display Components

| Component | File | Key Lines |
|-----------|------|-----------|
| Dashboard orchestrator | `src/tui/dashboard.ts` | 60-89 |
| Header with live totals | `src/tui/layout.ts` | 25-74 |
| History period stats | `src/tui/layout.ts` | 77-95 |
| Running table (per-worker) | `src/tui/layout.ts` | 97-162 |
| Sparkline TPS graph | `src/tui/sparkline.ts` | 1-68 |
| Number formatting | `src/tui/format.ts` | 36-49 |
