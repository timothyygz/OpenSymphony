import type { TrackerAdapter, CreateIssueData, HealthCheckResult } from "../types.ts";
import type { Issue, TokenUsage } from "../../../model/index.ts";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { GitHubApi } from "./api.ts";
import { mapGitHubIssueToIssue, extractSymphonyState, extractNonSymphonyLabels } from "./mapper.ts";
import { logger } from "../../../logging/logger.ts";
import { createTrackerMcpServer } from "../../agent/claude-code/tracker-tools.ts";

export const SYMPHONY_LABEL_PREFIX = "symphony::";

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
    if (states.length === 0) return [];
    if (states.length === 1 && states[0] === "*") {
      const issues = await this.api.listIssues({ state: "open", per_page: "100" });
      return issues.map(mapGitHubIssueToIssue);
    }
    const seen = new Set<number>();
    const results: Issue[] = [];
    for (const state of states) {
      const label = `${this.labelPrefix}${state}`;
      const issues = await this.api.listIssues({ labels: label, state: "open", per_page: "100" });
      for (const issue of issues) {
        if (!seen.has(issue.id)) {
          seen.add(issue.id);
          results.push(mapGitHubIssueToIssue(issue));
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
        results.push(mapGitHubIssueToIssue(issue));
      } catch (err) {
        logger.warn({ issueId: id, error: String(err) }, "Failed to fetch GitHub issue");
      }
    }
    return results;
  }

  async updateIssueState(issueId: string, state: string): Promise<void> {
    const issue = await this.api.getIssue(Number(issueId));
    const nonSymphonyLabels = extractNonSymphonyLabels(issue.labels);
    const newLabel = `${this.labelPrefix}${state}`;
    const labels = [...nonSymphonyLabels, newLabel];

    await this.api.updateIssue(Number(issueId), { labels });
    logger.info({ issueId, state }, "Updated issue state in GitHub tracker");
  }

  async updateIssueTokens(issueId: string, tokens: TokenUsage): Promise<void> {
    const issue = await this.api.getIssue(Number(issueId));
    const tokenMarker = `<!-- symphony-tokens: ${JSON.stringify(tokens)} -->`;
    const body = issue.body ?? "";
    const cleaned = body.replace(/<!-- symphony-tokens: .*? -->/g, "").trimEnd();
    await this.api.updateIssue(Number(issueId), { body: `${cleaned}\n\n${tokenMarker}` });
    logger.info({ issueId, totalTokens: tokens.totalTokens }, "Updated issue tokens in GitHub tracker");
  }

  async updateIssueJoinCommand(issueId: string, command: string): Promise<void> {
    const issue = await this.api.getIssue(Number(issueId));
    const marker = `<!-- symphony-join: ${command} -->`;
    const body = issue.body ?? "";
    const cleaned = body.replace(/<!-- symphony-join: .*? -->/g, "").trimEnd();
    await this.api.updateIssue(Number(issueId), { body: `${cleaned}\n\n${marker}` });
    logger.info({ issueId }, "Updated issue join command in GitHub tracker");
  }

  async updateIssueProgress(issueId: string, progress: string): Promise<void> {
    const issue = await this.api.getIssue(Number(issueId));
    const marker = `<!-- symphony-progress: ${progress} -->`;
    const body = issue.body ?? "";
    const cleaned = body.replace(/<!-- symphony-progress: .*? -->/g, "").trimEnd();
    await this.api.updateIssue(Number(issueId), { body: `${cleaned}\n\n${marker}` });
    logger.info({ issueId, progress }, "Updated issue progress in GitHub tracker");
  }

  async updateIssueResultSummary(issueId: string, summary: string): Promise<void> {
    const issue = await this.api.getIssue(Number(issueId));
    const marker = `<!-- symphony-result: ${summary} -->`;
    const body = issue.body ?? "";
    const cleaned = body.replace(/<!-- symphony-result: .*? -->/g, "").trimEnd();
    await this.api.updateIssue(Number(issueId), { body: `${cleaned}\n\n${marker}` });
    logger.info({ issueId }, "Updated issue result summary in GitHub tracker");
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

  async healthCheck(): Promise<HealthCheckResult[]> {
    const results: HealthCheckResult[] = [];

    try {
      const repo = await this.api.testConnection();
      results.push({ name: "GitHub connectivity", status: "pass", message: `Connected to ${repo.name}` });
    } catch (err) {
      results.push({ name: "GitHub connectivity", status: "fail", message: err instanceof Error ? err.message : String(err) });
      return results;
    }

    try {
      await this.api.listIssues({ per_page: "1" });
      results.push({ name: "GitHub repo access", status: "pass", message: "Can list issues" });
    } catch (err) {
      results.push({ name: "GitHub repo access", status: "fail", message: err instanceof Error ? err.message : String(err) });
    }

    return results;
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
