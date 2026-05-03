export interface Workspace {
  path: string;
  workspaceKey: string;
  createdNow: boolean;
}

export type RunAttemptStatus =
  | "preparing_workspace"
  | "building_prompt"
  | "launching_agent"
  | "initializing_session"
  | "streaming_turn"
  | "finishing"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "stalled"
  | "cancelled_by_reconciliation";

export interface RunAttempt {
  issueId: string;
  issueIdentifier: string;
  attempt: number | null;
  workspacePath: string;
  startedAt: Date;
  status: RunAttemptStatus;
  error?: string;
}
