import { describe, test, expect, beforeEach } from "bun:test";
import { GitLabIssuesAdapter } from "../../src/adapters/tracker/gitlab-issues/adapter.ts";
import type { GitLabApi } from "../../src/adapters/tracker/gitlab-issues/api.ts";

function createMockApi(): GitLabApi {
  let nextId = 1;
  const issues: any[] = [];

  return {
    host: "https://gitlab.example.com",
    projectId: "123",
    testConnection: async () => ({ name: "Test Project" }),
    listIssues: async (params: any) => {
      if (params.search) {
        return issues.filter((i: any) => i.title.includes(params.search));
      }
      if (params.labels) {
        const labelSet = new Set(params.labels.split(","));
        return issues.filter((i: any) =>
          i.labels.some((l: string) => labelSet.has(l)),
        );
      }
      return issues;
    },
    getIssue: async (id: number) => {
      const issue = issues.find((i: any) => i.iid === id);
      if (!issue) throw new Error(`Issue ${id} not found`);
      return issue;
    },
    createIssue: async (data: any) => {
      const issue = {
        iid: nextId++,
        title: data.title,
        description: data.description ?? "",
        labels: (data.labels ?? "").split(",").filter(Boolean),
        state: "opened",
      };
      issues.push(issue);
      return issue;
    },
    updateIssue: async (id: number, data: any) => {
      const issue = issues.find((i: any) => i.iid === id);
      if (!issue) throw new Error(`Issue ${id} not found`);
      Object.assign(issue, data);
    },
    createLabel: async () => {},
  } as unknown as GitLabApi;
}

function createAdapter(api: GitLabApi): GitLabIssuesAdapter {
  return new GitLabIssuesAdapter({
    host: "https://gitlab.example.com",
    token: "test-token",
    projectId: "123",
    labelPrefix: "symphony::",
    activeStates: ["Todo", "In Progress"],
    terminalStates: ["Done", "Cancelled"],
  });
}

// We need to inject the mock API. Since the adapter creates its own API,
// we'll test through the adapter's public interface by using a real-ish setup.
// For unit tests, we'll mock at a higher level.

describe("GitLabIssuesAdapter (unit)", () => {
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

  test("getDashboardUrl returns project issues URL", () => {
    const adapter = new GitLabIssuesAdapter({
      host: "https://gitlab.example.com",
      token: "test-token",
      projectId: "group/project",
      labelPrefix: "symphony::",
      activeStates: ["Todo"],
      terminalStates: ["Done"],
    });
    const url = adapter.getDashboardUrl();
    expect(url).toContain("gitlab.example.com");
    expect(url).toContain("/-/issues");
  });
});
