import type { Issue, TokenUsage } from "../../model/index.ts";

export type { TokenUsage };

export interface AgentEvent {
  event: string;
  timestamp: string;
  message?: string;
  usage?: TokenUsage;
  rateLimits?: unknown;
}

export interface AgentSession {
  id: string;
  turnCount: number;
  metadata: Record<string, unknown>;
}

export interface AgentSessionContext {
  workspacePath: string;
  issue: Issue;
  sessionId: string;
  config: Record<string, unknown>;
}

export interface TurnResult {
  status: "completed" | "failed" | "timed_out" | "cancelled";
  error?: string;
  usage?: TokenUsage;
}

export interface AgentAdapter {
  readonly kind: string;
  startSession(ctx: AgentSessionContext): Promise<AgentSession>;
  runTurn(session: AgentSession, prompt: string, onEvent: (event: AgentEvent) => void): Promise<TurnResult>;
  stopSession(session: AgentSession): Promise<void>;
}

export type AgentAdapterFactory = (config: Record<string, unknown>) => AgentAdapter;
