import { describe, test, expect } from "bun:test";
import { createTrackerTool } from "../../src/adapters/agent/claude-code/tracker-tools.ts";
import type { TrackerAdapter, CreateIssueData } from "../../src/adapters/tracker/types.ts";
import type { Issue } from "../../src/model/index.ts";

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "issue-1",
    identifier: "TEST-1",
    title: "Test Issue",
    description: null,
    priority: null,
    state: "Todo",
    branchName: null,
    url: null,
    labels: [],
    blockedBy: [],
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

function createMockAdapter(): TrackerAdapter {
  const issues: Issue[] = [
    makeIssue({ id: "1", title: "Issue Alpha", state: "Todo" }),
    makeIssue({ id: "2", title: "Issue Beta", state: "Done" }),
  ];

  return {
    kind: "mock",
    fetchCandidateIssues: async () => issues,
    fetchIssuesByStates: async () => issues,
    fetchIssueStatesByIds: async (ids) => issues.filter((i) => ids.includes(i.id)),
    updateIssueState: async () => {},
    updateIssueTokens: async () => {},
    getMcpServerConfig: () => ({}),
    createIssue: async (data: CreateIssueData) => {
      const issue = makeIssue({
        id: String(issues.length + 1),
        title: data.title,
        description: data.description ?? null,
        state: data.state ?? "Todo",
        labels: data.labels ?? [],
      });
      issues.push(issue);
      return issue;
    },
    searchIssues: async (query) =>
      issues.filter((i) => i.title.toLowerCase().includes(query.toLowerCase())),
  };
}

describe("createTrackerTool (generic)", () => {
  const adapter = createMockAdapter();
  const issueId = "1";

  function callHandler(args: Record<string, unknown>) {
    const toolDef = createTrackerTool(adapter, issueId);
    return toolDef.handler(args as any, {});
  }

  test("list action returns all issues", async () => {
    const result = await callHandler({ action: "list" });
    expect(result.isError).toBeUndefined();
    const text = (result.content as any[])[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.length).toBe(2);
  });

  test("get action returns the current issue", async () => {
    const result = await callHandler({ action: "get" });
    expect(result.isError).toBeUndefined();
    const text = (result.content as any[])[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.id).toBe("1");
  });

  test("get action returns error for nonexistent record", async () => {
    const result = await callHandler({ action: "get", record_id: "nonexistent" });
    expect(result.isError).toBe(true);
    const text = (result.content as any[])[0].text;
    expect(text).toContain("not found");
  });

  test("create action creates a new issue", async () => {
    const result = await callHandler({
      action: "create",
      fields: { title: "New Issue", description: "A test issue", state: "Todo" },
    });
    expect(result.isError).toBeUndefined();
    const text = (result.content as any[])[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.title).toBe("New Issue");
  });

  test("create action returns error when no title", async () => {
    const result = await callHandler({ action: "create" });
    expect(result.isError).toBe(true);
    const text = (result.content as any[])[0].text;
    expect(text).toContain("No title");
  });

  test("update action updates issue state", async () => {
    const result = await callHandler({
      action: "update",
      fields: { state: "In Progress" },
    });
    expect(result.isError).toBeUndefined();
    const text = (result.content as any[])[0].text;
    expect(text).toContain("updated successfully");
  });

  test("update action returns error when no fields", async () => {
    const result = await callHandler({ action: "update" });
    expect(result.isError).toBe(true);
    const text = (result.content as any[])[0].text;
    expect(text).toContain("No fields");
  });

  test("search action searches by query", async () => {
    const result = await callHandler({ action: "search", query: "alpha" });
    expect(result.isError).toBeUndefined();
    const text = (result.content as any[])[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.length).toBe(1);
    expect(parsed[0].title).toContain("Alpha");
  });

  test("search action returns error when no query", async () => {
    const result = await callHandler({ action: "search" });
    expect(result.isError).toBe(true);
    const text = (result.content as any[])[0].text;
    expect(text).toContain("Query is required");
  });
});
