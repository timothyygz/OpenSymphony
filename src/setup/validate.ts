import type { WizardResult, ExportData } from "./types.ts";

// --- Types ---

export interface ValidationDetail {
  field: string;
  message: string;
  suggestion?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationDetail[];
  warnings: ValidationDetail[];
}

// --- Backward-compatible function ---

/**
 * Validate a WizardResult before writing to disk.
 * Returns an array of error messages (empty = valid).
 */
export function validateWizardResult(result: WizardResult): string[] {
  return validateWizardResultDetailed(result).errors.map((e) => e.message);
}

// --- Detailed validation ---

export function validateWizardResultDetailed(
  result: WizardResult,
): ValidationResult {
  const errors: ValidationDetail[] = [];
  const warnings: ValidationDetail[] = [];

  // Tracker validation
  const tracker = result.tracker;
  if (!tracker.kind) {
    errors.push({
      field: "tracker.kind",
      message: "tracker.kind is required",
      suggestion: "Select a tracker type: feishu_bitable, gitlab_issues, or github_issues",
    });
  } else {
    switch (tracker.kind) {
      case "feishu_bitable":
        if (!tracker.app_token)
          errors.push({
            field: "tracker.app_token",
            message: "tracker.app_token is required for feishu_bitable",
            suggestion: "Provide --app-token, or paste a Bitable URL during setup",
          });
        if (!tracker.table_id)
          errors.push({
            field: "tracker.table_id",
            message: "tracker.table_id is required for feishu_bitable",
            suggestion: "Provide --table-id, or let the wizard create a table",
          });
        if (!tracker.state_field)
          errors.push({
            field: "tracker.state_field",
            message: "tracker.state_field is required for feishu_bitable",
            suggestion: "Default is '状态'. Set via --import if your table uses different names",
          });
        if (!tracker.identifier_field)
          errors.push({
            field: "tracker.identifier_field",
            message: "tracker.identifier_field is required for feishu_bitable",
            suggestion: "Default is '编号'. Set via --import if your table uses different names",
          });
        if (!tracker.title_field)
          errors.push({
            field: "tracker.title_field",
            message: "tracker.title_field is required for feishu_bitable",
            suggestion: "Default is '标题'. Set via --import if your table uses different names",
          });
        break;
      case "gitlab_issues":
        if (!tracker.gitlab_host)
          errors.push({
            field: "tracker.gitlab_host",
            message: "tracker.gitlab_host is required for gitlab_issues",
            suggestion: "Defaults to https://gitlab.com. For self-hosted, use --gitlab-host",
          });
        if (!tracker.project_id)
          errors.push({
            field: "tracker.project_id",
            message: "tracker.project_id is required for gitlab_issues",
            suggestion: "Use --project-id with the numeric ID or group/project path",
          });
        if (
          !tracker.active_states ||
          !(tracker.active_states as string[]).length
        )
          errors.push({
            field: "tracker.active_states",
            message: "tracker.active_states must be non-empty for gitlab_issues",
            suggestion:
              "Typical values: ['Todo', 'In Progress']. Use --active-states 'Todo,In Progress'",
          });
        if (
          !tracker.terminal_states ||
          !(tracker.terminal_states as string[]).length
        )
          errors.push({
            field: "tracker.terminal_states",
            message: "tracker.terminal_states must be non-empty for gitlab_issues",
            suggestion:
              "Typical values: ['Done', 'Cancelled']. Use --terminal-states 'Done,Cancelled'",
          });
        break;
      case "github_issues":
        if (!tracker.github_host)
          errors.push({
            field: "tracker.github_host",
            message: "tracker.github_host is required for github_issues",
            suggestion: "Defaults to https://github.com. For GHE, use the full URL",
          });
        if (!tracker.owner)
          errors.push({
            field: "tracker.owner",
            message: "tracker.owner is required for github_issues",
            suggestion: "Use the GitHub username or organization name",
          });
        if (!tracker.repo)
          errors.push({
            field: "tracker.repo",
            message: "tracker.repo is required for github_issues",
            suggestion: "Use the repository name (without the owner prefix)",
          });
        if (
          !tracker.active_states ||
          !(tracker.active_states as string[]).length
        )
          errors.push({
            field: "tracker.active_states",
            message: "tracker.active_states must be non-empty for github_issues",
            suggestion:
              "Typical values: ['Todo', 'In Progress']. Use --active-states 'Todo,In Progress'",
          });
        if (
          !tracker.terminal_states ||
          !(tracker.terminal_states as string[]).length
        )
          errors.push({
            field: "tracker.terminal_states",
            message: "tracker.terminal_states must be non-empty for github_issues",
            suggestion:
              "Typical values: ['Done', 'Cancelled']. Use --terminal-states 'Done,Cancelled'",
          });
        break;
      default:
        errors.push({
          field: "tracker.kind",
          message: `Unknown tracker kind: ${tracker.kind}`,
          suggestion: "Supported kinds: feishu_bitable, gitlab_issues, github_issues",
        });
    }
  }

  // Credentials validation
  if (result.credentials) {
    const kind = tracker.kind as string;
    switch (kind) {
      case "feishu_bitable":
        if (!result.credentials.app_id)
          errors.push({
            field: "credentials.app_id",
            message: "credentials.app_id is required for feishu_bitable",
            suggestion: "Get it from https://open.feishu.cn/app → Credentials page",
          });
        if (!result.credentials.app_secret)
          errors.push({
            field: "credentials.app_secret",
            message: "credentials.app_secret is required for feishu_bitable",
            suggestion: "Get it from https://open.feishu.cn/app → Credentials page",
          });
        break;
      case "gitlab_issues":
        if (!result.credentials.gitlab_token)
          errors.push({
            field: "credentials.gitlab_token",
            message: "credentials.gitlab_token is required for gitlab_issues",
            suggestion: "Create at GitLab → Settings → Access Tokens (api scope)",
          });
        break;
      case "github_issues":
        if (!result.credentials.github_token)
          errors.push({
            field: "credentials.github_token",
            message: "credentials.github_token is required for github_issues",
            suggestion: "Create at GitHub → Settings → Developer settings → Tokens (repo scope)",
          });
        break;
    }
  } else if (tracker.kind) {
    warnings.push({
      field: "credentials",
      message: `No credentials provided for ${tracker.kind as string}`,
      suggestion: "Credentials will be read from settings.json or env vars at runtime",
    });
  }

  // Agent validation
  const agent = result.agent as Record<string, unknown>;
  const agentConfig = agent.config as Record<string, unknown> | undefined;
  if (!agentConfig?.approval_policy) {
    errors.push({
      field: "agent.config.approval_policy",
      message: "agent.config.approval_policy is required",
      suggestion: 'Use "auto" for hands-free, or "suggest" for manual confirmation',
    });
  }

  // Workspace validation
  const workspace = result.workspace as Record<string, unknown>;
  if (!workspace.root) {
    errors.push({
      field: "workspace.root",
      message: "workspace.root is required",
      suggestion: "Use --workspace-root or accept the default",
    });
  }

  // Prompt template validation
  if (!result.promptTemplate || !result.promptTemplate.trim()) {
    errors.push({
      field: "promptTemplate",
      message: "promptTemplate must not be empty",
      suggestion: "Use --template basic.md, chinese.md, or provide a custom file",
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// --- Import data validation ---

export function validateImportData(data: unknown): ValidationResult {
  const errors: ValidationDetail[] = [];

  if (!data || typeof data !== "object") {
    errors.push({
      field: "root",
      message: "Import file must be a JSON object",
    });
    return { valid: false, errors, warnings: [] };
  }

  const obj = data as Record<string, unknown>;

  if (obj.version !== 1) {
    errors.push({
      field: "version",
      message: `Unsupported version: ${obj.version ?? "missing"}. Expected: 1`,
      suggestion: "Re-export your config with the current version of opensymphony",
    });
  }

  if (!obj.tracker || typeof obj.tracker !== "object") {
    errors.push({
      field: "tracker",
      message: "Missing or invalid 'tracker' field",
    });
  } else {
    const tracker = obj.tracker as Record<string, unknown>;
    if (!tracker.kind) {
      errors.push({
        field: "tracker.kind",
        message: "Missing 'tracker.kind' field",
      });
    }
    if (!tracker.config || typeof tracker.config !== "object") {
      errors.push({
        field: "tracker.config",
        message: "Missing or invalid 'tracker.config' field",
      });
    }
  }

  if (!obj.promptTemplate || typeof obj.promptTemplate !== "string") {
    errors.push({
      field: "promptTemplate",
      message: "Missing or empty 'promptTemplate' field",
    });
  }

  if (obj.agent === undefined || obj.agent === null) {
    errors.push({
      field: "agent",
      message: "Missing 'agent' field",
    });
  }

  if (obj.workspace === undefined || obj.workspace === null) {
    errors.push({
      field: "workspace",
      message: "Missing 'workspace' field",
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings: [],
  };
}
