import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import type { Issue, TokenUsage } from "../../model/index.ts";

export interface CreateIssueData {
  title: string;
  description?: string;
  state?: string;
  labels?: string[];
}

export interface HealthCheckResult {
  name: string;
  status: "pass" | "fail";
  message?: string;
}

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
  getMcpServerConfig(issueId: string): Record<string, McpServerConfig>;
  createIssue(data: CreateIssueData): Promise<Issue>;
  searchIssues(query: string): Promise<Issue[]>;
  healthCheck?(): Promise<HealthCheckResult[]>;
  getDashboardUrl?(): string | null;
}

export type TrackerAdapterFactory = (config: Record<string, unknown>) => TrackerAdapter;
