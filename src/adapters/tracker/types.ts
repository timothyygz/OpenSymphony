import type { Issue, TokenUsage } from "../../model/index.ts";

export interface TrackerAdapter {
  readonly kind: string;
  fetchCandidateIssues(): Promise<Issue[]>;
  fetchIssuesByStates(states: string[]): Promise<Issue[]>;
  fetchIssueStatesByIds(ids: string[]): Promise<Issue[]>;
  updateIssueState(issueId: string, state: string): Promise<void>;
  updateIssueTokens(issueId: string, tokens: TokenUsage): Promise<void>;
  updateIssueJoinCommand?(issueId: string, command: string): Promise<void>;
  updateIssueProgress?(issueId: string, progress: string): Promise<void>;
  updateIssueResultSummary?(issueId: string, summary: string): Promise<void>;
}

export type TrackerAdapterFactory = (config: Record<string, unknown>) => TrackerAdapter;
