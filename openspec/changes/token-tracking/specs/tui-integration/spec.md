## MODIFIED Requirements

### Requirement: TrackerAdapter supports token update
`TrackerAdapter` interface SHALL include a **required** method `updateIssueTokens(issueId: string, tokens: TokenUsage): Promise<void>`. Adapters that do not support token tracking SHALL implement this as a no-op (immediately resolving Promise).

#### Scenario: Feishu adapter updates tokens field
- **WHEN** `updateIssueTokens` is called with issueId "rec123" and `{ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 }`
- **THEN** the Feishu Bitable record is updated with the configured tokens field set to 1500

#### Scenario: Adapter without tokens field configured is no-op
- **WHEN** `tokensField` is not configured in FeishuBitableConfig
- **THEN** `updateIssueTokens` immediately resolves without calling the Feishu API

## ADDED Requirements

### Requirement: Orchestrator writes tokens to tracker on all worker termination paths
The orchestrator SHALL call `tracker.updateIssueTokens(issueId, entry.tokenUsage)` on all three worker termination paths: `onWorkerExit`, `reconcileStalled`, and `reconcileTrackerStates`. The call SHALL be fire-and-forget (NOT awaited) with error logging via `.catch()`.

#### Scenario: Normal exit updates tracker tokens
- **WHEN** a worker completes with 1500 total tokens
- **THEN** `tracker.updateIssueTokens` is called with the issue ID and token usage

#### Scenario: Failed exit updates tracker tokens
- **WHEN** a worker fails after consuming 800 total tokens
- **THEN** `tracker.updateIssueTokens` is still called with 800 tokens

#### Scenario: Stalled worker updates tracker tokens
- **WHEN** a stalled worker is terminated
- **THEN** `tracker.updateIssueTokens` is called with the token usage before stall detection

#### Scenario: Tracker update failure does not block
- **WHEN** `updateIssueTokens` throws a network error
- **THEN** the error is logged as a warning and the orchestrator continues normally (no await, no re-throw)

#### Scenario: Tracker update does not delay worker termination
- **WHEN** `updateIssueTokens` is called
- **THEN** the call is NOT awaited and does not block the termination flow

### Requirement: Feishu Bitable config accepts tokens field
`FeishuBitableConfig` SHALL accept an optional `tokensField` property specifying the field name in the Feishu Bitable table for token counts. The config key in WORKFLOW.md SHALL be `tokens_field`.

#### Scenario: Config with tokens_field
- **WHEN** WORKFLOW.md contains `tokens_field: "本次运行Token"`
- **THEN** `FeishuBitableConfig.tokensField` is set to "本次运行Token"

#### Scenario: Config without tokens_field
- **WHEN** WORKFLOW.md does not contain `tokens_field`
- **THEN** `FeishuBitableConfig.tokensField` is undefined and `updateIssueTokens` is a no-op
