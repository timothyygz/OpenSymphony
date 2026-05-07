## MODIFIED Requirements

### Requirement: Feishu connectivity check
Doctor SHALL test tracker API connectivity using configured credentials, routed by tracker `kind`. The check SHALL use the adapter's `healthCheck()` method when available.

#### Scenario: Adapter provides health check
- **WHEN** the configured tracker adapter implements `healthCheck()`
- **THEN** doctor SHALL call `adapter.healthCheck()` and report each result as pass/fail

#### Scenario: Adapter without health check
- **WHEN** the configured tracker adapter does not implement `healthCheck()`
- **THEN** doctor SHALL skip tracker-specific checks and report a warning

#### Scenario: Auth pass
- **WHEN** adapter health check returns pass for connectivity
- **THEN** doctor SHALL report PASS

#### Scenario: Auth fail
- **WHEN** adapter health check returns fail for connectivity
- **THEN** doctor SHALL report FAIL with credential verification instructions

#### Scenario: Bitable access pass
- **WHEN** adapter health check returns pass for resource access (app_token and table_id are valid and records can be listed)
- **THEN** doctor SHALL report PASS

#### Scenario: Bitable access fail
- **WHEN** adapter health check returns fail for resource access
- **THEN** doctor SHALL report FAIL with resource URL and permission check instructions
