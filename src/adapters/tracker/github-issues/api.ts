import { logger } from "../../../logging/logger.ts";

export interface GitHubApiConfig {
  host: string;
  token: string;
  owner: string;
  repo: string;
}

export class GitHubApi {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  readonly owner: string;
  readonly repo: string;
  readonly host: string;

  constructor(config: GitHubApiConfig) {
    this.host = config.host;
    this.baseUrl = `${config.host}/api/v3`;
    this.headers = {
      Authorization: `Bearer ${config.token}`,
      Accept: "application/vnd.github+json",
    };
    this.owner = config.owner;
    this.repo = config.repo;
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      headers: { ...this.headers, ...options?.headers },
      ...options,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GitHub API ${res.status}: ${body}`);
    }
    return res.json() as Promise<T>;
  }

  async listIssues(params?: Record<string, string>): Promise<GitHubIssueResponse[]> {
    const query = new URLSearchParams(params).toString();
    const path = `/repos/${this.owner}/${this.repo}/issues${query ? `?${query}` : ""}`;
    const issues = await this.request<GitHubIssueResponse[]>(path);
    // GitHub returns PRs mixed with issues; filter to issues only
    return issues.filter((i) => !("pull_request" in i));
  }

  async getIssue(number: number): Promise<GitHubIssueResponse> {
    return this.request<GitHubIssueResponse>(`/repos/${this.owner}/${this.repo}/issues/${number}`);
  }

  async createIssue(data: Record<string, unknown>): Promise<GitHubIssueResponse> {
    return this.request<GitHubIssueResponse>(`/repos/${this.owner}/${this.repo}/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  }

  async updateIssue(number: number, data: Record<string, unknown>): Promise<GitHubIssueResponse> {
    return this.request<GitHubIssueResponse>(`/repos/${this.owner}/${this.repo}/issues/${number}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  }

  async testConnection(): Promise<{ name: string }> {
    return this.request<{ name: string }>(`/repos/${this.owner}/${this.repo}`);
  }

  async createLabel(name: string, color: string): Promise<void> {
    try {
      await this.request(`/repos/${this.owner}/${this.repo}/labels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color }),
      });
    } catch (err) {
      logger.debug({ label: name, error: String(err) }, "Label creation skipped");
    }
  }
}

export interface GitHubIssueResponse {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: string;
  labels: Array<{ name: string; color: string }>;
  html_url: string;
  created_at: string;
  updated_at: string;
  pull_request?: unknown;
}
