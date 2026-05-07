import { logger } from "../../../logging/logger.ts";

export interface GitLabApiConfig {
  host: string;
  token: string;
  projectId: string;
}

export class GitLabApi {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  readonly projectId: string;
  private readonly encodedProjectId: string;
  readonly host: string;

  constructor(config: GitLabApiConfig) {
    this.host = config.host;
    this.baseUrl = `${config.host}/api/v4`;
    this.headers = { "PRIVATE-TOKEN": config.token };
    this.projectId = config.projectId;
    this.encodedProjectId = encodeURIComponent(config.projectId);
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      headers: { ...this.headers, "Content-Type": "application/json", ...options?.headers },
      ...options,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GitLab API ${res.status}: ${body}`);
    }
    return res.json() as Promise<T>;
  }

  async listIssues(params?: Record<string, string>): Promise<GitLabIssueResponse[]> {
    const query = new URLSearchParams(params).toString();
    const path = `/projects/${this.encodedProjectId}/issues${query ? `?${query}` : ""}`;
    return this.request<GitLabIssueResponse[]>(path);
  }

  async getIssue(iid: number): Promise<GitLabIssueResponse> {
    return this.request<GitLabIssueResponse>(`/projects/${this.encodedProjectId}/issues/${iid}`);
  }

  async createIssue(data: Record<string, unknown>): Promise<GitLabIssueResponse> {
    return this.request<GitLabIssueResponse>(`/projects/${this.encodedProjectId}/issues`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateIssue(iid: number, data: Record<string, unknown>): Promise<GitLabIssueResponse> {
    return this.request<GitLabIssueResponse>(`/projects/${this.encodedProjectId}/issues/${iid}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async testConnection(): Promise<{ name: string }> {
    return this.request<{ name: string }>(`/projects/${this.encodedProjectId}`);
  }

  async createLabel(name: string, color: string): Promise<void> {
    try {
      await this.request(`/projects/${this.encodedProjectId}/labels`, {
        method: "POST",
        body: JSON.stringify({ name, color }),
      });
    } catch (err) {
      // Label may already exist
      logger.debug({ label: name, error: String(err) }, "Label creation skipped");
    }
  }
}

export interface GitLabIssueResponse {
  id: number;
  iid: number;
  title: string;
  description: string | null;
  state: string;
  labels: string[];
  weight: number | null;
  web_url: string;
  references: { short: string; full: string };
  created_at: string;
  updated_at: string;
}
