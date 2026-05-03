## 1. Data Model & Aggregator

- [x] 1.1 Define `PeriodStats` and `HistoryStats` interfaces in `src/model/session.ts`
- [x] 1.2 Create `src/metrics/aggregator.ts` — implement `aggregate(filePath: string)` that reads JSONL, groups records by today/this-week/this-month using local timezone, and returns `HistoryStats`
- [x] 1.3 Handle edge cases: missing file, empty file, corrupted lines (skip with logger.warn)

## 2. TUI History Section

- [x] 2.1 Add `formatHistory(history: HistoryStats)` function in `src/tui/layout.ts` — renders a compact line with Today/Week/Month stats, color-coded
- [x] 2.2 Wire the history section into the dashboard layout in `src/tui/dashboard.ts` — call `formatHistory()` between header and running table

## 3. Dashboard Integration

- [x] 3.1 Add aggregator cache to `Dashboard` class — store `lastHistoryQuery` timestamp and cached `HistoryStats`, refresh on 30-second cadence
- [x] 3.2 Pass cached `HistoryStats` to `formatHistory()` during each render tick

## 4. Tests

- [x] 4.1 Test `aggregate()` with a temp JSONL file covering records across multiple days/weeks/months — verify correct bucketing
- [x] 4.2 Test `aggregate()` with empty file and corrupted lines — verify graceful handling
- [x] 4.3 Test `formatHistory()` output — verify formatting, color codes, and separator structure
