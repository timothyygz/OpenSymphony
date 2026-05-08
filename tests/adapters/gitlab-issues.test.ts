import { describe, test, expect } from "bun:test";
import { GitLabIssuesAdapter, createGitLabIssuesAdapter } from "../../src/adapters/tracker/gitlab-issues/adapter.ts";
import type { GitLabIssueResponse } from "../../src/adapters/tracker/gitlab-issues/api.ts";

function makeGitLabIssue(overrides: Partial<GitLabIssueResponse> = {}): GitLabIssueResponse {
  return {
    id: Math.floor(Math.random() * 10000),
    iid: 1,
    title: "Test issue",
    description: "desc",
    state: "opened",
    labels: [],
    weight: null,
    web_url: "https://gitlab.com/project/-/issues/1",
    references: { short: "#1", full: "project#1" },
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    ...overrides,
  };
}

// Mock API that simulates real GitLab AND semantics for comma-separated labels
function createMockApi(issues: GitLabIssueResponse[] = []) {
  const calls: { labels?: string; state?: string }[] = [];

  return {
    _calls: calls,
    api: {
      host: "https://gitlab.example.com",
      projectId: "group/project",
      testConnection: async () => ({ name: "Test Project" }),
      // Real GitLab behavior: comma-separated labels = AND (must have ALL)
      listIssues: async (params: Record<string, string>) => {
        calls.push({ labels: params.labels, state: params.state });
        if (params.labels) {
          const required = params.labels.split(",");
          return issues.filter((i) =>
            required.every((l) => i.labels.includes(l)),
          );
        }
        return issues;
      },
      getIssue: async (id: number) => {
        const issue = issues.find((i) => i.iid === id);
        if (!issue) throw new Error(`Issue ${id} not found`);
        return issue;
      },
      createIssue: async () => { throw new Error("not implemented"); },
      updateIssue: async () => { throw new Error("not implemented"); },
      createLabel: async () => {},
    } as unknown as import("../../src/adapters/tracker/gitlab-issues/api.ts").GitLabApi,
  };
}

// Patch adapter to inject mock API
function createAdapterWithMock(
  issues: GitLabIssueResponse[] = [],
  opts: { activeStates?: string[]; terminalStates?: string[] } = {},
) {
  const mock = createMockApi(issues);
  const adapter = new GitLabIssuesAdapter({
    host: "https://gitlab.example.com",
    token: "test-token",
    projectId: "group/project",
    labelPrefix: "symphony::",
    activeStates: opts.activeStates ?? ["Todo", "In Progress"],
    terminalStates: opts.terminalStates ?? ["Done", "Cancelled"],
  });
  // Replace internal api
  (adapter as unknown as { api: typeof mock.api }).api = mock.api;
  return { adapter, mock };
}

describe("GitLabIssuesAdapter", () => {
  test("kind is gitlab_issues", () => {
    const adapter = new GitLabIssuesAdapter({
      host: "https://gitlab.example.com",
      token: "test-token",
      projectId: "123",
      labelPrefix: "symphony::",
      activeStates: ["Todo"],
      terminalStates: ["Done"],
    });
    expect(adapter.kind).toBe("gitlab_issues");
  });

  describe("getDashboardUrl", () => {
    test("returns project issues URL with path-style projectId", () => {
      const adapter = new GitLabIssuesAdapter({
        host: "https://gitlab.example.com",
        token: "test-token",
        projectId: "group/project",
        labelPrefix: "symphony::",
        activeStates: ["Todo"],
        terminalStates: ["Done"],
      });
      const url = adapter.getDashboardUrl();
      expect(url).toBe("https://gitlab.example.com/group/project/-/issues");
      // Must NOT be URL-encoded
      expect(url).not.toContain("%2F");
    });

    test("returns URL with numeric projectId", () => {
      const adapter = new GitLabIssuesAdapter({
        host: "https://gitlab.sto.cn",
        token: "test-token",
        projectId: "1301334/issure-demo",
        labelPrefix: "symphony::",
        activeStates: ["Todo"],
        terminalStates: ["Done"],
      });
      const url = adapter.getDashboardUrl();
      expect(url).toBe("https://gitlab.sto.cn/1301334/issure-demo/-/issues");
    });
  });

  describe("fetchCandidateIssues", () => {
    test("returns issues matching any active state (OR logic)", async () => {
      const issues = [
        makeGitLabIssue({ id: 1, iid: 1, labels: ["symphony::Todo"] }),
        makeGitLabIssue({ id: 2, iid: 2, labels: ["symphony::In Progress"] }),
        makeGitLabIssue({ id: 3, iid: 3, labels: ["symphony::Done"] }),
      ];
      const { adapter } = createAdapterWithMock(issues);

      const result = await adapter.fetchCandidateIssues();

      // Should get issues with Todo OR In Progress, not Done
      expect(result.length).toBe(2);
      expect(result.map((i) => i.id).sort()).toEqual(["1", "2"]);
    });

    test("deduplicates issues that match multiple states", async () => {
      const issues = [
        makeGitLabIssue({ id: 1, iid: 1, labels: ["symphony::Todo", "symphony::In Progress"] }),
      ];
      const { adapter } = createAdapterWithMock(issues);

      const result = await adapter.fetchCandidateIssues();

      expect(result.length).toBe(1);
      expect(result[0].id).toBe("1");
    });

    test("queries each state label separately", async () => {
      const issues: GitLabIssueResponse[] = [];
      const { adapter, mock } = createAdapterWithMock(issues);

      await adapter.fetchCandidateIssues();

      // Should have made one API call per active state
      expect(mock._calls.length).toBe(2);
      expect(mock._calls[0].labels).toBe("symphony::Todo");
      expect(mock._calls[1].labels).toBe("symphony::In Progress");
    });

    test("returns empty when no issues match", async () => {
      const { adapter } = createAdapterWithMock([]);
      const result = await adapter.fetchCandidateIssues();
      expect(result).toEqual([]);
    });

    test("single active state works correctly", async () => {
      const issues = [
        makeGitLabIssue({ id: 1, iid: 1, labels: ["symphony::Todo"] }),
        makeGitLabIssue({ id: 2, iid: 2, labels: ["symphony::In Progress"] }),
      ];
      const { adapter } = createAdapterWithMock(issues, { activeStates: ["Todo"] });

      const result = await adapter.fetchCandidateIssues();
      expect(result.length).toBe(1);
      expect(result[0].id).toBe("1");
    });
  });

  describe("fetchIssuesByStates", () => {
    test("wildcard state returns all open issues", async () => {
      const issues = [
        makeGitLabIssue({ id: 1, iid: 1, labels: ["symphony::Todo"] }),
        makeGitLabIssue({ id: 2, iid: 2, labels: ["symphony::Done"] }),
        makeGitLabIssue({ id: 3, iid: 3, labels: ["bug"] }),
      ];
      const { adapter } = createAdapterWithMock(issues);

      const result = await adapter.fetchIssuesByStates(["*"]);
      expect(result.length).toBe(3);
    });

    test("empty states returns empty", async () => {
      const { adapter } = createAdapterWithMock([]);
      const result = await adapter.fetchIssuesByStates([]);
      expect(result).toEqual([]);
    });
  });

  describe("createGitLabIssuesAdapter factory", () => {
    test("creates adapter with correct defaults", () => {
      const adapter = createGitLabIssuesAdapter({
        gitlab_host: "https://gitlab.example.com",
        gitlab_token: "test-token",
        project_id: "123",
      });
      expect(adapter.kind).toBe("gitlab_issues");
    });

    test("defaults host to gitlab.com when not provided", () => {
      const adapter = createGitLabIssuesAdapter({
        gitlab_token: "test-token",
        project_id: "123",
      });
      expect(adapter.kind).toBe("gitlab_issues");
    });
  });
});
