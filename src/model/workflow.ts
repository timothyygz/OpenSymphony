import { z } from "zod";

export interface WorkflowDefinition {
  config: Record<string, unknown>;
  promptTemplate: string;
}

// --- Tracker config ---

export const trackerConfigSchema = z.object({
  kind: z.string(),
  endpoint: z.string().optional(),
  api_key: z.string().optional(),
  project_slug: z.string().optional(),
  active_states: z.array(z.string()).default(["Todo", "In Progress"]),
  terminal_states: z.array(z.string()).default(["Closed", "Cancelled", "Canceled", "Duplicate", "Done"]),
  // Feishu Bitable specific
  app_id: z.string().optional(),
  app_secret: z.string().optional(),
  app_token: z.string().optional(),
  table_id: z.string().optional(),
  state_field: z.string().optional(),
  identifier_field: z.string().optional(),
  title_field: z.string().optional(),
  description_field: z.string().optional(),
  priority_field: z.string().optional(),
  labels_field: z.string().optional(),
  tokens_field: z.string().optional(),
  join_command_field: z.string().optional(),
  progress_field: z.string().optional(),
  result_summary_field: z.string().optional(),
  // GitLab Issues specific
  gitlab_host: z.string().optional(),
  gitlab_token: z.string().optional(),
  project_id: z.string().optional(),
  label_prefix: z.string().optional(),
});
export type TrackerConfig = z.infer<typeof trackerConfigSchema>;

// --- Polling config ---

export const pollingConfigSchema = z.object({
  interval_ms: z.number().default(30000),
});
export type PollingConfig = z.infer<typeof pollingConfigSchema>;

// --- Workspace config ---

const gitCloneSourceSchema = z.object({
  type: z.literal("git-clone"),
  url: z.string(),
  path: z.string(),
  branch: z.string().optional(),
  depth: z.number().optional().default(1),
});

const gitWorktreeSourceSchema = z.object({
  type: z.literal("git-worktree"),
  repo: z.string(),
  path: z.string().optional(),
  branch: z.string().optional(),
});

export const workspaceSourceSchema = z.discriminatedUnion("type", [
  gitCloneSourceSchema,
  gitWorktreeSourceSchema,
]);
export type WorkspaceSource = z.infer<typeof workspaceSourceSchema>;

export const workspaceConfigSchema = z.object({
  root: z.string().default(""),
  sources: z.array(workspaceSourceSchema).optional().default([]),
});
export type WorkspaceConfig = z.infer<typeof workspaceConfigSchema>;

// --- Hooks config ---

export const hooksConfigSchema = z.object({
  after_create: z.string().optional(),
  before_run: z.string().optional(),
  after_run: z.string().optional(),
  before_remove: z.string().optional(),
  timeout_ms: z.number().default(60000),
});
export type HooksConfig = z.infer<typeof hooksConfigSchema>;

// --- Agent config (unified) ---

export const agentConfigSchema = z.object({
  kind: z.string().default("claude-code"),
  stall_timeout_ms: z.number().default(300000),
  max_concurrent_agents: z.number().default(10),
  max_turns: z.number().positive().default(20),
  max_retry_backoff_ms: z.number().default(300000),
  max_retry_attempts: z.number().default(3),
  max_concurrent_agents_by_state: z.record(z.string(), z.number().positive()).default({} as Record<string, number>),
  // Agent-specific config, passed through to the adapter
  config: z.record(z.string(), z.unknown()).default({}),
  // State names for dispatch/retry transitions (defaults to Chinese for backward compat)
  in_progress_state: z.string().default("进行中"),
  active_reset_state: z.string().default("待处理"),
  permanent_failure_state: z.string().default("永久失败"),
});
export type AgentConfig = z.infer<typeof agentConfigSchema>;

// --- Full ServiceConfig ---

export const serviceConfigSchema = z.object({
  tracker: trackerConfigSchema,
  polling: pollingConfigSchema.optional().default({ interval_ms: 30000 }),
  workspace: workspaceConfigSchema.optional().default({ root: "", sources: [] }),
  hooks: hooksConfigSchema.optional().default({ timeout_ms: 60000 }),
  agent: agentConfigSchema.optional().default({ kind: "claude-code", stall_timeout_ms: 300000, max_concurrent_agents: 10, max_turns: 20, max_retry_backoff_ms: 300000, max_retry_attempts: 3, max_concurrent_agents_by_state: {}, config: {}, in_progress_state: "进行中", active_reset_state: "待处理", permanent_failure_state: "永久失败" }),
  server: z.object({
    port: z.number().optional(),
  }).optional(),
});
export type ServiceConfig = z.infer<typeof serviceConfigSchema>;
