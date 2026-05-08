import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { symphonySettings } from "../paths.ts";
import { serviceConfigSchema, type ServiceConfig } from "../model/index.ts";
import { ConfigValidationError } from "../errors/errors.ts";
import { logger } from "../logging/logger.ts";

interface GlobalSettings {
  tracker?: {
    [kind: string]: Record<string, unknown>;
  };
}

let _cachedSettings: GlobalSettings | null = null;

const emptySettings: GlobalSettings = {};

export function resetGlobalSettingsCache(): void {
  _cachedSettings = null;
}

function loadGlobalSettings(): GlobalSettings {
  if (_cachedSettings !== null) return _cachedSettings;
  const settingsPath = process.env.SYMPHONY_SETTINGS_PATH
    ?? symphonySettings();
  if (!existsSync(settingsPath)) {
    _cachedSettings = emptySettings;
    return _cachedSettings;
  }
  try {
    _cachedSettings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    logger.debug({ path: settingsPath }, "Loaded global settings");
  } catch (err) {
    logger.warn({ err, path: settingsPath }, "Failed to load global settings");
    _cachedSettings = emptySettings;
  }
  return _cachedSettings!;
}

export function resolveEnvValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (!value.startsWith("$")) return value;
  const varName = value.slice(1);
  const resolved = process.env[varName];
  if (resolved === "" || resolved === undefined) return undefined;
  return resolved;
}

export function expandPath(pathStr: string, baseDir: string): string {
  let expanded = pathStr;
  if (expanded.startsWith("~")) {
    expanded = expanded.replace(/^~/, homedir());
  }
  if (!expanded.startsWith("/")) {
    expanded = resolve(baseDir, expanded);
  }
  return expanded;
}

export function buildServiceConfig(
  rawConfig: Record<string, unknown>,
  workflowDir: string,
): ServiceConfig {
  // Resolve $VAR indirection in known env-backed fields
  const config = { ...rawConfig };

  // Backward compatibility: migrate legacy codex/claude_code to unified agent config
  if (!config.agent || typeof config.agent !== "object") {
    const agent: Record<string, unknown> = {};
    if (config.claude_code && typeof config.claude_code === "object") {
      agent.kind = "claude-code";
      agent.config = { ...config.claude_code as Record<string, unknown> };
      // Copy stall_timeout_ms from codex if available
      if (config.codex && typeof config.codex === "object") {
        const codex = config.codex as Record<string, unknown>;
        if (codex.stall_timeout_ms !== undefined) agent.stall_timeout_ms = codex.stall_timeout_ms;
        if (codex.max_concurrent_agents !== undefined) agent.max_concurrent_agents = codex.max_concurrent_agents;
        if (codex.max_turns !== undefined) agent.max_turns = codex.max_turns;
        if (codex.max_retry_backoff_ms !== undefined) agent.max_retry_backoff_ms = codex.max_retry_backoff_ms;
      }
    } else if (config.codex && typeof config.codex === "object") {
      agent.kind = "claude-code";
      const codex = config.codex as Record<string, unknown>;
      agent.config = { command: codex.command ?? "claude" };
      if (codex.stall_timeout_ms !== undefined) agent.stall_timeout_ms = codex.stall_timeout_ms;
      if (codex.max_concurrent_agents !== undefined) agent.max_concurrent_agents = codex.max_concurrent_agents;
      if (codex.max_turns !== undefined) agent.max_turns = codex.max_turns;
      if (codex.max_retry_backoff_ms !== undefined) agent.max_retry_backoff_ms = codex.max_retry_backoff_ms;
    }
    if (Object.keys(agent).length > 0) {
      config.agent = agent;
    }
  }

  if (config.tracker && typeof config.tracker === "object") {
    const tracker = config.tracker as Record<string, unknown>;

    // Merge global settings as defaults for missing credential fields
    const globals = loadGlobalSettings();
    const kind = tracker.kind as string;
    if (kind && globals.tracker?.[kind]) {
      const kindDefaults = globals.tracker[kind]!;
      for (const [key, value] of Object.entries(kindDefaults)) {
        if (tracker[key] === undefined && value !== undefined) {
          tracker[key] = value;
        }
      }
    }

    if (typeof tracker.api_key === "string") {
      tracker.api_key = resolveEnvValue(tracker.api_key) as string | undefined;
    }
    if (typeof tracker.app_id === "string") {
      tracker.app_id = resolveEnvValue(tracker.app_id) as string | undefined;
    }
    if (typeof tracker.app_secret === "string") {
      tracker.app_secret = resolveEnvValue(tracker.app_secret) as string | undefined;
    }
    if (typeof tracker.gitlab_token === "string") {
      tracker.gitlab_token = resolveEnvValue(tracker.gitlab_token) as string | undefined;
    }
  }

  if (config.workspace && typeof config.workspace === "object") {
    const workspace = config.workspace as Record<string, unknown>;
    if (typeof workspace.root === "string") {
      workspace.root = expandPath(workspace.root, workflowDir);
    }
  }

  const parsed = serviceConfigSchema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    logger.error({ errors: issues }, "Config validation failed");
    throw new ConfigValidationError(`Invalid config: ${issues}`);
  }

  // Apply workspace root default after parsing
  const svc = parsed.data;
  if (!svc.workspace.root) {
    svc.workspace.root = resolve(tmpdir(), "symphony_workspaces");
  }

  return svc;
}

export function validateDispatchConfig(config: ServiceConfig): string | null {
  if (!config.tracker.kind) {
    return "tracker.kind is required";
  }
  if (config.tracker.kind === "feishu_bitable") {
    if (!config.tracker.app_token) return "tracker.app_token is required (set in WORKFLOW.md or ~/.open-symphony/settings.json)";
    if (!config.tracker.table_id) return "tracker.table_id is required (set in WORKFLOW.md or ~/.open-symphony/settings.json)";
    if (!config.tracker.app_id) return "tracker.app_id is required (set in WORKFLOW.md, ~/.open-symphony/settings.json, or $FEISHU_APP_ID)";
    if (!config.tracker.app_secret) return "tracker.app_secret is required (set in WORKFLOW.md, ~/.open-symphony/settings.json, or $FEISHU_APP_SECRET)";
    if (!config.tracker.state_field) return "tracker.state_field is required for feishu_bitable";
    if (!config.tracker.identifier_field) return "tracker.identifier_field is required for feishu_bitable";
    if (!config.tracker.title_field) return "tracker.title_field is required for feishu_bitable";
  }
  if (config.tracker.kind === "linear") {
    if (!config.tracker.api_key) return "tracker.api_key ($LINEAR_API_KEY) is required";
    if (!config.tracker.project_slug) return "tracker.project_slug is required for linear";
  }
  if (config.tracker.kind === "gitlab_issues") {
    if (!config.tracker.gitlab_host) return "tracker.gitlab_host is required for gitlab_issues";
    if (!config.tracker.gitlab_token) return "tracker.gitlab_token is required (set in WORKFLOW.md, ~/.open-symphony/settings.json, or $GITLAB_TOKEN)";
    if (!config.tracker.project_id) return "tracker.project_id is required for gitlab_issues";
  }
  // Check agent kind is specified
  if (!config.agent.kind) return "agent.kind is required";
  return null;
}
