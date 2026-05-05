import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import type { Issue, TokenUsage } from "../../model/index.ts";
import type { RateLimitInfo } from "../../orchestrator/state.ts";

export type { TokenUsage };

export interface ClaudeStreamEvent {
  type: string;
  message?: { content: unknown[]; usage?: unknown };
  tool_name?: string;
  tool_input?: unknown;
  result?: string;
  [key: string]: unknown;
}

export interface AgentEvent {
  event: string;
  timestamp: string;
  message?: string;
  usage?: TokenUsage;
  rateLimits?: RateLimitInfo;
  rawEvent?: ClaudeStreamEvent;
  toolName?: string;
  toolInput?: unknown;
  sessionId?: string;
}

export interface AgentSessionMetadata {
  workspacePath: string;
  sessionId?: string;
  realSessionId?: string;
  issueIdentifier?: string;
  mcpServers?: Record<string, McpServerConfig>;
  [key: string]: unknown;
}

export interface AgentSession {
  id: string;
  turnCount: number;
  metadata: AgentSessionMetadata;
}

export interface AgentSessionContext {
  workspacePath: string;
  issue: Issue;
  sessionId: string;
  config: Record<string, unknown>;
  mcpServers?: Record<string, McpServerConfig>;
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
