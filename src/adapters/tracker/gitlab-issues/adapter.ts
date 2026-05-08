import type { TrackerAdapter, CreateIssueData, HealthCheckResult } from "../types.ts";
import type { Issue, TokenUsage } from "../../../model/index.ts";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { GitLabApi } from "./api.ts";
import { mapGitLabIssueToIssue, extractSymphonyState, extractNonSymphonyLabels } from "./mapper.ts";
import { logger } from "../../../logging/logger.ts";
import { createTrackerMcpServer } from "../../agent/claude-code/tracker-tools.ts";

const SYMPHONY_LABEL_PREFIX = "symphony::";

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
    if (states.length === 0) return [];
    if (states.length === 1 && states[0] === "*") {
      const issues = await this.api.listIssues({ state: "opened", per_page: "100" });
      return issues.map(mapGitLabIssueToIssue);
    }
    // GitLab API treats comma-separated labels as AND, but we need OR.
    // Query each state label separately and deduplicate by issue id.
    const seen = new Set<number>();
    const results: Issue[] = [];
    for (const state of states) {
      const label = `${this.labelPrefix}${state}`;
      const issues = await this.api.listIssues({ labels: label, state: "opened", per_page: "100" });
      for (const issue of issues) {
        if (!seen.has(issue.id)) {
          seen.add(issue.id);
          results.push(mapGitLabIssueToIssue(issue));
        }
      }
    }
    return results;
  }

  async fetchIssueStatesByIds(ids: string[]): Promise<Issue[]> {
    if (ids.length === 0) return [];
    const results: Issue[] = [];
    for (const id of ids) {
      try {
        const issue = await this.api.getIssue(Number(id));
        results.push(mapGitLabIssueToIssue(issue));
      } catch (err) {
        logger.warn({ issueId: id, error: String(err) }, "Failed to fetch GitLab issue");
      }
    }
    return results;
  }

  async updateIssueState(issueId: string, state: string): Promise<void> {
    const issue = await this.api.getIssue(Number(issueId));
    const nonSymphonyLabels = extractNonSymphonyLabels(issue.labels);
    const newLabel = `${this.labelPrefix}${state}`;
    const labels = [...nonSymphonyLabels, newLabel];

    await this.api.updateIssue(Number(issueId), { labels: labels.join(",") });
    logger.info({ issueId, state }, "Updated issue state in GitLab tracker");
  }

  async updateIssueTokens(issueId: string, tokens: TokenUsage): Promise<void> {
    const issue = await this.api.getIssue(Number(issueId));
    const tokenMarker = `<!-- symphony-tokens: ${JSON.stringify(tokens)} -->`;
    const desc = issue.description ?? "";
    const cleaned = desc.replace(/<!-- symphony-tokens: .*? -->/g, "").trimEnd();
    await this.api.updateIssue(Number(issueId), { description: `${cleaned}\n\n${tokenMarker}` });
    logger.info({ issueId, totalTokens: tokens.totalTokens }, "Updated issue tokens in GitLab tracker");
  }

  async updateIssueJoinCommand(issueId: string, command: string): Promise<void> {
    const issue = await this.api.getIssue(Number(issueId));
    const marker = `<!-- symphony-join: ${command} -->`;
    const desc = issue.description ?? "";
    const cleaned = desc.replace(/<!-- symphony-join: .*? -->/g, "").trimEnd();
    await this.api.updateIssue(Number(issueId), { description: `${cleaned}\n\n${marker}` });
    logger.info({ issueId }, "Updated issue join command in GitLab tracker");
  }

  async updateIssueProgress(issueId: string, progress: string): Promise<void> {
    const issue = await this.api.getIssue(Number(issueId));
    const marker = `<!-- symphony-progress: ${progress} -->`;
    const desc = issue.description ?? "";
    const cleaned = desc.replace(/<!-- symphony-progress: .*? -->/g, "").trimEnd();
    await this.api.updateIssue(Number(issueId), { description: `${cleaned}\n\n${marker}` });
    logger.info({ issueId, progress }, "Updated issue progress in GitLab tracker");
  }

  async updateIssueResultSummary(issueId: string, summary: string): Promise<void> {
    const issue = await this.api.getIssue(Number(issueId));
    const marker = `<!-- symphony-result: ${summary} -->`;
    const desc = issue.description ?? "";
    const cleaned = desc.replace(/<!-- symphony-result: .*? -->/g, "").trimEnd();
    await this.api.updateIssue(Number(issueId), { description: `${cleaned}\n\n${marker}` });
    logger.info({ issueId }, "Updated issue result summary in GitLab tracker");
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

  async healthCheck(): Promise<HealthCheckResult[]> {
    const results: HealthCheckResult[] = [];

    try {
      const project = await this.api.testConnection();
      results.push({ name: "GitLab connectivity", status: "pass", message: `Connected to ${project.name}` });
    } catch (err) {
      results.push({ name: "GitLab connectivity", status: "fail", message: err instanceof Error ? err.message : String(err) });
      return results;
    }

    try {
      await this.api.listIssues({ per_page: "1" });
      results.push({ name: "GitLab project access", status: "pass", message: "Can list issues" });
    } catch (err) {
      results.push({ name: "GitLab project access", status: "fail", message: err instanceof Error ? err.message : String(err) });
    }

    return results;
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
