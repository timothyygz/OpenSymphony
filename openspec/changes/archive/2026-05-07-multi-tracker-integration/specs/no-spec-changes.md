## No spec changes required

All capability specs already exist in `openspec/specs/` and describe the target state:

- `tracker-feedback/spec.md` — defines `createIssue`, `searchIssues`, `healthCheck`, `getMcpServerConfig` requirements
- `tracker-mcp-tool/spec.md` — defines generic tracker MCP tool requirements
- `init-wizard/spec.md` — defines tracker type selection and setup routing
- `doctor/spec.md` — defines `adapter.healthCheck()` routing
- `gitlab-tracker/spec.md` — defines GitLab adapter behavior

This change is purely implementation: the code must be updated to match existing specs.
