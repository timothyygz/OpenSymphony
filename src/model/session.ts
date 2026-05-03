import type { Issue } from "./issue.ts";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface LiveSession {
  sessionId: string;
  codexAppServerPid: number | null;
  lastCodexEvent: string | null;
  lastCodexTimestamp: Date | null;
  lastCodexMessage: string | null;
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
  codexAppServerPid: number | null;
  lastCodexEvent: string | null;
  lastCodexTimestamp: Date | null;
  lastCodexMessage: string | null;
  tokenUsage: TokenUsage;
  lastReportedTokenUsage: TokenUsage;
  retryAttempt: number;
  startedAt: Date;
  turnCount: number;
}

export interface AggregateTotals {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  secondsRunning: number;
}
