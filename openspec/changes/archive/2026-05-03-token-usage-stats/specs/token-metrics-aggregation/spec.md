## ADDED Requirements

### Requirement: Aggregate token records by time period
The `MetricsAggregator` SHALL read the JSONL token log and group records into three time buckets: today (local calendar day), this week (ISO week, Monday–Sunday), and this month (local calendar month). Each bucket SHALL contain `inputTokens`, `outputTokens`, `totalTokens`, and `issueCount`.

#### Scenario: Records span multiple days
- **WHEN** the JSONL file contains records from today, yesterday, and 3 days ago
- **THEN** the "today" bucket includes only records whose `completedAt` falls on the current local calendar day

#### Scenario: Records span multiple weeks
- **WHEN** the JSONL file contains records from this ISO week and the previous ISO week
- **THEN** the "this week" bucket includes only records whose `completedAt` falls in the current ISO week (Monday–Sunday)

#### Scenario: Records span multiple months
- **WHEN** the JSONL file contains records from this month and last month
- **THEN** the "this month" bucket includes only records whose `completedAt` falls in the current local calendar month

### Requirement: Aggregator returns structured result
The aggregator SHALL return a `HistoryStats` object with three fields: `today`, `week`, `month`. Each field SHALL be a `PeriodStats` object containing `inputTokens`, `outputTokens`, `totalTokens`, and `issueCount`.

#### Scenario: Full aggregation result
- **WHEN** the JSONL file has records across multiple time periods
- **THEN** the returned object has `today`, `week`, and `month` fields, each with independently computed totals

#### Scenario: Empty JSONL file
- **WHEN** the JSONL file does not exist or is empty
- **THEN** all period stats SHALL have zero values (`inputTokens: 0`, `outputTokens: 0`, `totalTokens: 0`, `issueCount: 0`)

### Requirement: Corrupted lines are skipped
The aggregator SHALL skip lines that fail JSON parsing, matching the existing `TokenLog.summary()` behavior.

#### Scenario: Mixed valid and corrupted lines
- **WHEN** the JSONL file has 10 valid records and 2 corrupted lines
- **THEN** the 10 valid records are aggregated and the 2 corrupted lines are silently skipped
