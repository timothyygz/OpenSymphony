export class SymphonyError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SymphonyError";
    this.code = code;
  }
}

// Workflow errors
export class MissingWorkflowFileError extends SymphonyError {
  constructor(path: string) {
    super("missing_workflow_file", `Workflow file not found: ${path}`);
  }
}

export class WorkflowParseError extends SymphonyError {
  constructor(reason: string) {
    super("workflow_parse_error", `Failed to parse workflow: ${reason}`);
  }
}

export class WorkflowFrontMatterNotMapError extends SymphonyError {
  constructor() {
    super("workflow_front_matter_not_a_map", "Workflow front matter must be a YAML map/object");
  }
}

export class TemplateParseError extends SymphonyError {
  constructor(reason: string) {
    super("template_parse_error", `Template parse error: ${reason}`);
  }
}

export class TemplateRenderError extends SymphonyError {
  constructor(reason: string) {
    super("template_render_error", `Template render error: ${reason}`);
  }
}

// Tracker errors
export class UnsupportedTrackerKindError extends SymphonyError {
  constructor(kind: string) {
    super("unsupported_tracker_kind", `Unsupported tracker kind: ${kind}`);
  }
}

export class MissingTrackerApiKeyError extends SymphonyError {
  constructor() {
    super("missing_tracker_api_key", "Tracker API key is missing");
  }
}

export class TrackerApiError extends SymphonyError {
  readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super("tracker_api_error", message);
    this.statusCode = statusCode;
  }
}

// Agent errors
export class AgentSessionError extends SymphonyError {
  constructor(code: string, message: string) {
    super(code, message);
  }
}

export class AgentNotFoundError extends AgentSessionError {
  constructor(command: string) {
    super("agent_not_found", `Agent command not found: ${command}`);
  }
}

export class AgentTurnTimeoutError extends AgentSessionError {
  constructor(timeoutMs: number) {
    super("turn_timeout", `Agent turn timed out after ${timeoutMs}ms`);
  }
}

// Workspace errors
export class WorkspaceSafetyError extends SymphonyError {
  constructor(message: string) {
    super("workspace_safety_error", message);
  }
}

export class WorkspaceCreationError extends SymphonyError {
  constructor(message: string) {
    super("workspace_creation_error", message);
  }
}

// Config errors
export class ConfigValidationError extends SymphonyError {
  constructor(message: string) {
    super("config_validation_error", message);
  }
}
