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
});
export type TrackerConfig = z.infer<typeof trackerConfigSchema>;

// --- Polling config ---

export const pollingConfigSchema = z.object({
  interval_ms: z.number().default(30000),
});
export type PollingConfig = z.infer<typeof pollingConfigSchema>;

// --- Workspace config ---

export const workspaceConfigSchema = z.object({
  root: z.string().default(""),
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

// --- Agent config ---

export const agentConfigSchema = z.object({
  max_concurrent_agents: z.number().default(10),
  max_turns: z.number().positive().default(20),
  max_retry_backoff_ms: z.number().default(300000),
  max_concurrent_agents_by_state: z.record(z.string(), z.number().positive()).default({} as Record<string, number>),
});
export type AgentConfig = z.infer<typeof agentConfigSchema>;

// --- Codex / Claude Code config ---

export const codexConfigSchema = z.object({
  command: z.string().default("codex app-server"),
  approval_policy: z.string().optional(),
  thread_sandbox: z.string().optional(),
  turn_sandbox_policy: z.string().optional(),
  turn_timeout_ms: z.number().default(3600000),
  read_timeout_ms: z.number().default(5000),
  stall_timeout_ms: z.number().default(300000),
});
export type CodexConfig = z.infer<typeof codexConfigSchema>;

// --- Full ServiceConfig ---

export const serviceConfigSchema = z.object({
  tracker: trackerConfigSchema,
  polling: pollingConfigSchema.optional().default({ interval_ms: 30000 }),
  workspace: workspaceConfigSchema.optional().default({ root: "" }),
  hooks: hooksConfigSchema.optional().default({ timeout_ms: 60000 }),
  agent: agentConfigSchema.optional().default({ max_concurrent_agents: 10, max_turns: 20, max_retry_backoff_ms: 300000, max_concurrent_agents_by_state: {} }),
  codex: codexConfigSchema.optional().default({ command: "codex app-server", turn_timeout_ms: 3600000, read_timeout_ms: 5000, stall_timeout_ms: 300000 }),
  // Extensions
  claude_code: z.object({
    command: z.string().default("claude"),
    output_format: z.string().default("stream-json"),
    timeout_ms: z.number().default(3600000),
    approval_policy: z.string().optional(),
  }).optional(),
  server: z.object({
    port: z.number().optional(),
  }).optional(),
});
export type ServiceConfig = z.infer<typeof serviceConfigSchema>;
