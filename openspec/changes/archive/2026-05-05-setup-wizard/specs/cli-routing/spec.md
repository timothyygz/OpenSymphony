## MODIFIED Requirements

### Requirement: CLI argument parsing
The CLI SHALL support subcommand routing for `init` and `doctor` commands, while maintaining backward compatibility with the existing positional WORKFLOW.md path argument.

#### Scenario: Subcommand routing
- **WHEN** first positional argument is `init`
- **THEN** CLI SHALL delegate to the init command handler
- **WHEN** first positional argument is `doctor`
- **THEN** CLI SHALL delegate to the doctor command handler

#### Scenario: Backward compatible start
- **WHEN** first positional argument is not a known subcommand
- **THEN** CLI SHALL treat it as a WORKFLOW.md path and start the orchestrator (current behavior)

#### Scenario: No arguments
- **WHEN** no positional arguments are provided
- **THEN** CLI SHALL start the orchestrator with default WORKFLOW.md path (current behavior)

#### Scenario: Help display
- **WHEN** `--help` or `-h` is provided
- **THEN** CLI SHALL display help text listing all subcommands and options

## ADDED Requirements

### Requirement: Command module structure
Subcommand handlers SHALL be organized in `src/commands/` directory, one file per command.

#### Scenario: Command file structure
- **WHEN** a new subcommand is added
- **THEN** it SHALL be implemented as a separate file in `src/commands/` exporting an async function
