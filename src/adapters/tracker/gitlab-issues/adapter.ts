import type { TrackerAdapter, CreateIssueData } from "../types.ts";
import type { Issue, TokenUsage } from "../../../model/index.ts";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { GitLabApi } from "./api.ts";
import { mapGitLabIssueToIssue } from "./mapper.ts";
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

export interface GitLabIssuesConfig {
  host: string;
  token: string;
  projectId: string;
  labelPrefix: string;
  activeStates: string[];
  terminalStates: string[];
}

export class GitLabIssuesAdapter implements TrackerAdapter {
  readonly kind = "gitlab_issues";
  private readonly api: GitLabApi;
  private readonly labelPrefix: string;
  private readonly activeStates: string[];
  private readonly terminalStates: string[];

  constructor(config: GitLabIssuesConfig) {
    this.api = new GitLabApi({
      host: config.host,
      token: config.token,
      projectId: config.projectId,
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
      mapFn: mapGitLabIssueToIssue,
      openStateValue: "opened",
    });
  }

  async fetchIssueStatesByIds(ids: string[]): Promise<Issue[]> {
    return fetchIssuesByIds({
      ids,
      getFn: (id) => this.api.getIssue(id),
      mapFn: mapGitLabIssueToIssue,
      kind: "GitLab",
    });
  }

  async updateIssueState(issueId: string, state: string): Promise<void> {
    return updateLabelState({
      issueId,
      state,
      labelPrefix: this.labelPrefix,
      getFn: (id) => this.api.getIssue(id),
      updateFn: (id, data) => this.api.updateIssue(id, data),
      getLabels: (raw) => raw.labels,
      buildLabelsParam: (labels) => labels.join(","),
    });
  }

  async updateIssueTokens(issueId: string, tokens: TokenUsage): Promise<void> {
    return updateTokens({
      issueId,
      tokens,
      getFn: (id) => this.api.getIssue(id),
      updateFn: (id, data) => this.api.updateIssue(id, data),
      getBody: (raw) => raw.description,
      buildBodyParam: (body) => body,
      kind: "GitLab",
    });
  }

  async updateIssueJoinCommand(issueId: string, command: string): Promise<void> {
    return updateBodyMetadata({
      issueId,
      metadataKey: "join",
      value: command,
      getFn: (id) => this.api.getIssue(id),
      updateFn: (id, data) => this.api.updateIssue(id, data),
      getBody: (raw) => raw.description,
      buildBodyParam: (body) => body,
      kind: "GitLab",
    });
  }

  async updateIssueProgress(issueId: string, progress: string): Promise<void> {
    return updateBodyMetadata({
      issueId,
      metadataKey: "progress",
      value: progress,
      getFn: (id) => this.api.getIssue(id),
      updateFn: (id, data) => this.api.updateIssue(id, data),
      getBody: (raw) => raw.description,
      buildBodyParam: (body) => body,
      kind: "GitLab",
    });
  }

  async updateIssueResultSummary(issueId: string, summary: string): Promise<void> {
    return updateBodyMetadata({
      issueId,
      metadataKey: "result",
      value: summary,
      getFn: (id) => this.api.getIssue(id),
      updateFn: (id, data) => this.api.updateIssue(id, data),
      getBody: (raw) => raw.description,
      buildBodyParam: (body) => body,
      kind: "GitLab",
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
      description: data.description ?? "",
      labels: labels.join(","),
    });
    return mapGitLabIssueToIssue(created);
  }

  async searchIssues(query: string): Promise<Issue[]> {
    const issues = await this.api.listIssues({ search: query, state: "opened", per_page: "20" });
    return issues.map(mapGitLabIssueToIssue);
  }

  async healthCheck() {
    return healthCheckSequence({
      connectionTestFn: () => this.api.testConnection(),
      listFn: (params) => this.api.listIssues(params),
      connectivityName: "GitLab connectivity",
      accessName: "GitLab project access",
    });
  }

  getDashboardUrl(): string | null {
    return `${this.api.host}/${this.api.projectId}/-/issues`;
  }
}

export function createGitLabIssuesAdapter(rawConfig: Record<string, unknown>): TrackerAdapter {
  return new GitLabIssuesAdapter({
    host: (rawConfig.gitlab_host as string) ?? "https://gitlab.com",
    token: rawConfig.gitlab_token as string,
    projectId: String(rawConfig.project_id),
    labelPrefix: (rawConfig.label_prefix as string) ?? SYMPHONY_LABEL_PREFIX,
    activeStates: (rawConfig.active_states as string[]) ?? ["Todo", "In Progress"],
    terminalStates: (rawConfig.terminal_states as string[]) ?? ["Done", "Cancelled"],
  });
}
