## ADDED Requirements

### Requirement: History section renders three time periods
The TUI SHALL display a "History" section between the header and the running agents table. It SHALL render token usage for three time periods on a single line: Today, This Week, and This Month. Each period SHALL show total tokens and issue count in the format `<period>: <tokens> tokens (<N> issues)`.

#### Scenario: All periods have data
- **WHEN** the aggregator returns non-zero stats for all three periods
- **THEN** the history line displays: `Today: 12,345 tokens (3 issues) │ Week: 98,765 tokens (15 issues) │ Month: 234,567 tokens (42 issues)`

#### Scenario: One period has no data
- **WHEN** the aggregator returns zero stats for "today"
- **THEN** the today segment displays `Today: 0 tokens (0 issues)`

#### Scenario: No historical data at all
- **WHEN** the JSONL file is empty and all periods return zeros
- **THEN** the history section still renders with all three periods showing zero values

### Requirement: History section uses color coding
The period labels SHALL use distinct ANSI colors: cyan for Today, magenta for This Week, yellow for This Month. Token values SHALL use the same color as their period label. The `│` separators SHALL be gray.

#### Scenario: Colorized output
- **WHEN** the history section is rendered
- **THEN** "Today:" appears in cyan, "Week:" appears in magenta, "Month:" appears in yellow, and separators appear in gray

### Requirement: History data refreshes on 30-second cadence
The dashboard SHALL query the aggregator at a 30-second interval, not on every TUI render tick. The result SHALL be cached between queries. On the first render, the aggregator SHALL be queried immediately.

#### Scenario: First dashboard render
- **WHEN** the dashboard starts
- **THEN** the aggregator is queried immediately and history stats are displayed

#### Scenario: Subsequent refresh within 30 seconds
- **WHEN** the dashboard renders 5 seconds after the last aggregator query
- **THEN** the cached history stats are used without re-reading the JSONL file

#### Scenario: Refresh after 30 seconds
- **WHEN** 30 seconds have elapsed since the last aggregator query
- **THEN** the dashboard re-queries the aggregator on the next render tick
