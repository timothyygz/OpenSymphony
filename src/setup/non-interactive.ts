import type { WizardResult } from "./types.ts";
import type { InitArgs } from "./args.ts";
import { loadTemplate, TEMPLATE_PRESETS } from "./yaml.ts";
import { validateWizardResult } from "./validate.ts";
import { readImportFile, exportDataToWizardResult } from "./export.ts";
import { DIR_NAME } from "../paths.ts";

/**
 * Build a WizardResult from CLI args without interactive prompts.
 * Returns either { ok: true, result } or { ok: false, errors }.
 */
export function nonInteractiveInit(
  args: InitArgs,
): { ok: true; result: WizardResult } | { ok: false; errors: string[] } {
  // --- Import short-circuit ---
  if (args.importPath) {
    const importResult = readImportFile(args.importPath);
    if (!importResult.ok) return { ok: false, errors: importResult.errors };
    const result = exportDataToWizardResult(importResult.data);
    const validationErrors = validateWizardResult(result);
    if (validationErrors.length > 0) return { ok: false, errors: validationErrors };
    return { ok: true, result };
  }

  const errors: string[] = [];

  // --- Tracker ---
  if (!args.tracker) {
    errors.push("--tracker is required in non-interactive mode. Available: feishu_bitable, gitlab_issues, github_issues. Or use --import <file> to restore a saved config.");
  }

  let trackerConfig: Record<string, unknown> = {};
  let credentials: Record<string, string> = {};

  if (args.tracker === "feishu_bitable") {
    if (!args.appId) errors.push("Missing --app-id. Required for feishu_bitable. Get it from https://open.feishu.cn/app → Credentials page.");
    if (!args.appSecret) errors.push("Missing --app-secret. Required for feishu_bitable. Get it from https://open.feishu.cn/app → Credentials page.");
    if (!args.appToken) errors.push("Missing --app-token. Required for feishu_bitable. Provide the Bitable app token or use --import.");
    if (!args.tableId) errors.push("Missing --table-id. Required for feishu_bitable. Provide the table ID or use --import.");

    trackerConfig = {
      kind: "feishu_bitable",
      app_token: args.appToken ?? "",
      table_id: args.tableId ?? "",
      state_field: "状态",
      identifier_field: "编号",
      title_field: "标题",
      description_field: "描述",
      priority_field: "优先级",
      labels_field: "标签",
      tokens_field: "tokens消耗",
      progress_field: "进度",
      result_summary_field: "结果摘要",
      join_command_field: "操作命令",
    };
    credentials = {
      app_id: args.appId ?? "",
      app_secret: args.appSecret ?? "",
    };
  } else if (args.tracker === "gitlab_issues") {
    if (!args.gitlabToken) errors.push("Missing --gitlab-token. Required for gitlab_issues. Create at GitLab → Settings → Access Tokens (api scope).");
    if (!args.projectId) errors.push("Missing --project-id. Required for gitlab_issues. Use the numeric ID or group/project path.");

    trackerConfig = {
      kind: "gitlab_issues",
      gitlab_host: args.gitlabHost || "https://gitlab.com",
      project_id: args.projectId ?? "",
      active_states: args.activeStates
        ? args.activeStates.split(",").map((s) => s.trim())
        : ["Todo", "In Progress"],
      terminal_states: args.terminalStates
        ? args.terminalStates.split(",").map((s) => s.trim())
        : ["Done", "Cancelled"],
    };
    credentials = {
      gitlab_token: args.gitlabToken ?? "",
    };
  } else if (args.tracker === "github_issues") {
    if (!args.githubToken) errors.push("Missing --github-token. Required for github_issues. Create at GitHub → Settings → Developer settings → Tokens (repo scope).");
    if (!args.githubOwner) errors.push("Missing --github-owner. Required for github_issues. Use the GitHub username or organization name.");
    if (!args.githubRepo) errors.push("Missing --github-repo. Required for github_issues. Use the repository name.");

    trackerConfig = {
      kind: "github_issues",
      github_host: args.githubHost || "https://github.com",
      owner: args.githubOwner ?? "",
      repo: args.githubRepo ?? "",
      active_states: args.activeStates
        ? args.activeStates.split(",").map((s) => s.trim())
        : ["Todo", "In Progress"],
      terminal_states: args.terminalStates
        ? args.terminalStates.split(",").map((s) => s.trim())
        : ["Done", "Cancelled"],
    };
    credentials = {
      github_token: args.githubToken ?? "",
    };
  } else if (args.tracker) {
    errors.push(`Unknown tracker type: ${args.tracker}. Supported: feishu_bitable, gitlab_issues, github_issues`);
  }

  // --- Agent ---
  const approvalPolicy = args.approvalPolicy || "auto";
  if (approvalPolicy !== "auto" && approvalPolicy !== "suggest") {
    errors.push(`Invalid --approval-policy: ${approvalPolicy}. Must be "auto" or "suggest"`);
  }

  // --- Workspace ---
  const workspaceRoot = args.workspaceRoot || `~/${DIR_NAME}/workspace`;
  const workspaceConfig: Record<string, unknown> = { root: workspaceRoot };

  if (args.workspaceType === "git-clone") {
    if (!args.gitUrl) errors.push("Missing --git-url. Required for git-clone workspace.");
    const source: Record<string, unknown> = {
      type: "git-clone",
      url: args.gitUrl ?? "",
      path: args.gitPath || "repo",
      depth: 1,
    };
    if (args.gitBranch) source.branch = args.gitBranch;
    workspaceConfig.sources = [source];
  } else if (args.workspaceType === "git-worktree") {
    if (!args.gitRepo) errors.push("Missing --git-repo. Required for git-worktree workspace.");
    workspaceConfig.sources = [{
      type: "git-worktree",
      repo: args.gitRepo ?? "",
      path: args.gitPath || "repo",
    }];
  } else if (args.workspaceType && args.workspaceType !== "none") {
    errors.push(`Invalid --workspace-type: ${args.workspaceType}. Must be "none", "git-clone", or "git-worktree"`);
  }

  // --- Template ---
  let promptTemplate: string;
  if (args.template) {
    // Check if it's a preset name or a custom file path
    const preset = TEMPLATE_PRESETS.find(
      (t) => t.file === args.template || t.name === args.template,
    );
    if (preset) {
      promptTemplate = loadTemplate(preset.file);
    } else {
      try {
        promptTemplate = Bun.file(args.template).textSync();
      } catch {
        errors.push(`Cannot read template file: ${args.template}`);
        promptTemplate = "";
      }
    }
  } else {
    promptTemplate = loadTemplate("basic.md");
  }

  // Check for early errors
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const result: WizardResult = {
    tracker: trackerConfig,
    workspace: workspaceConfig,
    agent: { config: { approval_policy: approvalPolicy } },
    promptTemplate,
    credentials: Object.keys(credentials).length > 0 ? credentials : undefined,
  };

  // Validate with shared validator
  const validationErrors = validateWizardResult(result);
  if (validationErrors.length > 0) {
    return { ok: false, errors: validationErrors };
  }

  return { ok: true, result };
}
