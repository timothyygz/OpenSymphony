import type { TrackerAdapter, CreateIssueData } from "../types.ts";
import type { Issue, TokenUsage } from "../../../model/index.ts";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { GitHubApi } from "./api.ts";
import { mapGitHubIssueToIssue } from "./mapper.ts";
import { createTrackerMcpServer } from "../../agent/claude-code/tracker-tools.ts";
import {
  SYMPHONY_LABEL_PREFIX,
  fetchIssuesByLabelStates,
  fetchIssuesByIds,
  updateLabelState,
  updateBodyMetadata,
  updateTokens,
  healthCheckSequence,
} from "../label-based/common.ts";

export interface GitHubIssuesConfig {
  host: string;
  token: string;
  owner: string;
  repo: string;
  labelPrefix: string;
  activeStates: string[];
  terminalStates: string[];
}

export class GitHubIssuesAdapter implements TrackerAdapter {
  readonly kind = "github_issues";
  private readonly api: GitHubApi;
  private readonly labelPrefix: string;
  private readonly activeStates: string[];
  private readonly terminalStates: string[];

  constructor(config: GitHubIssuesConfig) {
    this.api = new GitHubApi({
      host: config.host,
      token: config.token,
      owner: config.owner,
      repo: config.repo,
    });
    this.labelPrefix = config.labelPrefix || SYMPHONY_LABEL_PREFIX;
    this.activeStates = config.activeStates.map((s) => s.trim());
    this.terminalStates = config.terminalStates.map((s) => s.trim());
  }

  async fetchCandidateIssues(): Promise<Issue[]> {
    return this.fetchIssuesByStates(this.activeStates);
  }

  async fetchIssuesByStates(states: string[]): Promise<Issue[]> {
    return fetchIssuesByLabelStates({
      states,
      labelPrefix: this.labelPrefix,
      listFn: (params) => this.api.listIssues(params),
      mapFn: mapGitHubIssueToIssue,
      openStateValue: "open",
    });
  }

  async fetchIssueStatesByIds(ids: string[]): Promise<Issue[]> {
    return fetchIssuesByIds({
      ids,
      getFn: (id) => this.api.getIssue(id),
      mapFn: mapGitHubIssueToIssue,
      kind: "GitHub",
    });
  }

  async updateIssueState(issueId: string, state: string): Promise<void> {
    return updateLabelState({
      issueId,
      state,
      labelPrefix: this.labelPrefix,
      getFn: (id) => this.api.getIssue(id),
      updateFn: (id, data) => this.api.updateIssue(id, data),
      getLabels: (raw) => raw.labels.map((l: { name: string }) => l.name),
      buildLabelsParam: (labels) => labels,
    });
  }

  async updateIssueTokens(issueId: string, tokens: TokenUsage): Promise<void> {
    return updateTokens({
      issueId,
      tokens,
      getFn: (id) => this.api.getIssue(id),
      updateFn: (id, data) => this.api.updateIssue(id, data),
      getBody: (raw) => raw.body,
      buildBodyParam: (body) => body,
      kind: "GitHub",
    });
  }

  async updateIssueJoinCommand(issueId: string, command: string): Promise<void> {
    return updateBodyMetadata({
      issueId,
      metadataKey: "join",
      value: command,
      getFn: (id) => this.api.getIssue(id),
      updateFn: (id, data) => this.api.updateIssue(id, data),
      getBody: (raw) => raw.body,
      buildBodyParam: (body) => body,
      kind: "GitHub",
    });
  }

  async updateIssueProgress(issueId: string, progress: string): Promise<void> {
    return updateBodyMetadata({
      issueId,
      metadataKey: "progress",
      value: progress,
      getFn: (id) => this.api.getIssue(id),
      updateFn: (id, data) => this.api.updateIssue(id, data),
      getBody: (raw) => raw.body,
      buildBodyParam: (body) => body,
      kind: "GitHub",
    });
  }

  async updateIssueResultSummary(issueId: string, summary: string): Promise<void> {
    return updateBodyMetadata({
      issueId,
      metadataKey: "result",
      value: summary,
      getFn: (id) => this.api.getIssue(id),
      updateFn: (id, data) => this.api.updateIssue(id, data),
      getBody: (raw) => raw.body,
      buildBodyParam: (body) => body,
      kind: "GitHub",
    });
  }

  getMcpServerConfig(issueId: string): Record<string, McpServerConfig> {
    const trackerMcpServer = createTrackerMcpServer(this, issueId);
    return { tracker: trackerMcpServer };
  }

  async createIssue(data: CreateIssueData): Promise<Issue> {
    const labels: string[] = [...(data.labels ?? [])];
    if (data.state) labels.push(`${this.labelPrefix}${data.state}`);
    const created = await this.api.createIssue({
      title: data.title,
      body: data.description ?? "",
      labels,
    });
    return mapGitHubIssueToIssue(created);
  }

  async searchIssues(query: string): Promise<Issue[]> {
    const issues = await this.api.listIssues({ q: query, state: "open", per_page: "20" });
    return issues.map(mapGitHubIssueToIssue);
  }

  async healthCheck() {
    return healthCheckSequence({
      connectionTestFn: () => this.api.testConnection(),
      listFn: (params) => this.api.listIssues(params),
      connectivityName: "GitHub connectivity",
      accessName: "GitHub repo access",
    });
  }

  getDashboardUrl(): string | null {
    return `${this.api.host}/${this.api.owner}/${this.api.repo}/issues`;
  }
}

export function createGitHubIssuesAdapter(rawConfig: Record<string, unknown>): TrackerAdapter {
  return new GitHubIssuesAdapter({
    host: (rawConfig.github_host as string) ?? "https://github.com",
    token: rawConfig.github_token as string,
    owner: rawConfig.owner as string,
    repo: rawConfig.repo as string,
    labelPrefix: (rawConfig.label_prefix as string) ?? SYMPHONY_LABEL_PREFIX,
    activeStates: (rawConfig.active_states as string[] | undefined) ?? ["Todo", "In Progress"],
    terminalStates: (rawConfig.terminal_states as string[] | undefined) ?? ["Done", "Cancelled"],
  });
}
