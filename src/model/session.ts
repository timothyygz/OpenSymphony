import type { Issue } from "./issue.ts";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface LiveSession {
  sessionId: string;
  agentPid: number | null;
  lastAgentEvent: string | null;
  lastAgentTimestamp: Date | null;
  lastAgentMessage: string | null;
  tokenUsage: TokenUsage;
  lastReportedTokenUsage: TokenUsage;
  turnCount: number;
}

export interface RetryEntry {
  issueId: string;
  identifier: string;
  attempt: number;
  dueAtMs: number;
  timerHandle: ReturnType<typeof setTimeout> | null;
  error: string | null;
}

export interface RunningEntry {
  issue: Issue;
  identifier: string;
  sessionId: string | null;
  agentPid: number | null;
  lastAgentEvent: string | null;
  lastAgentTimestamp: Date | null;
  lastAgentMessage: string | null;
  tokenUsage: TokenUsage;
  lastReportedTokenUsage: TokenUsage;
  retryAttempt: number;
  startedAt: Date;
  turnCount: number;
}
