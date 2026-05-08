import { describe, test, expect } from "bun:test";
import {
  extractSymphonyState,
  extractNonSymphonyLabels,
  mapGitLabIssueToIssue,
} from "../../src/adapters/tracker/gitlab-issues/mapper.ts";
import type { GitLabIssueResponse } from "../../src/adapters/tracker/gitlab-issues/api.ts";

function makeGitLabIssue(overrides: Partial<GitLabIssueResponse> = {}): GitLabIssueResponse {
  return {
    id: 10,
    iid: 2,
    title: "Test issue",
    description: "desc",
    state: "opened",
    labels: [],
    weight: null,
    web_url: "https://gitlab.com/project/-/issues/2",
    references: { short: "#2", full: "project#2" },
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    ...overrides,
  };
}

describe("extractSymphonyState", () => {
  test("extracts state from symphony label", () => {
    expect(extractSymphonyState(["symphony::Todo", "bug"], "opened")).toBe("Todo");
  });

  test("extracts state from label with spaces", () => {
    expect(extractSymphonyState(["symphony::In Progress"], "opened")).toBe("In Progress");
  });

  test("returns fallback when no symphony label", () => {
    expect(extractSymphonyState(["bug", "feature"], "opened")).toBe("opened");
  });

  test("returns fallback when labels empty", () => {
    expect(extractSymphonyState([], "closed")).toBe("closed");
  });
});

describe("extractNonSymphonyLabels", () => {
  test("filters out symphony labels", () => {
    expect(extractNonSymphonyLabels(["symphony::Todo", "bug", "feature"]))
      .toEqual(["bug", "feature"]);
  });

  test("returns all labels when none are symphony", () => {
    expect(extractNonSymphonyLabels(["bug", "feature"])).toEqual(["bug", "feature"]);
  });

  test("returns empty when all are symphony", () => {
    expect(extractNonSymphonyLabels(["symphony::Todo", "symphony::Done"])).toEqual([]);
  });
});

describe("mapGitLabIssueToIssue", () => {
  test("maps basic fields", () => {
    const result = mapGitLabIssueToIssue(makeGitLabIssue());
    expect(result.id).toBe("2");
    expect(result.identifier).toBe("#2");
    expect(result.title).toBe("Test issue");
    expect(result.description).toBe("desc");
  });

  test("extracts state from symphony label", () => {
    const result = mapGitLabIssueToIssue(
      makeGitLabIssue({ labels: ["symphony::In Progress"] }),
    );
    expect(result.state).toBe("In Progress");
  });

  test("falls back to GitLab state when no symphony label", () => {
    const result = mapGitLabIssueToIssue(
      makeGitLabIssue({ state: "closed", labels: ["bug"] }),
    );
    expect(result.state).toBe("closed");
  });

  test("maps weight to priority", () => {
    const result = mapGitLabIssueToIssue(makeGitLabIssue({ weight: 5 }));
    expect(result.priority).toBe(5);
  });

  test("maps null weight to null priority", () => {
    const result = mapGitLabIssueToIssue(makeGitLabIssue({ weight: null }));
    expect(result.priority).toBeNull();
  });

  test("maps null description", () => {
    const result = mapGitLabIssueToIssue(makeGitLabIssue({ description: null }));
    expect(result.description).toBeNull();
  });

  test("filters out symphony labels from result", () => {
    const result = mapGitLabIssueToIssue(
      makeGitLabIssue({ labels: ["symphony::Todo", "bug", "feature"] }),
    );
    expect(result.labels).toEqual(["bug", "feature"]);
  });

  test("maps dates correctly", () => {
    const result = mapGitLabIssueToIssue(makeGitLabIssue({
      created_at: "2026-03-15T10:30:00Z",
      updated_at: "2026-03-16T12:00:00Z",
    }));
    expect(result.createdAt).toEqual(new Date("2026-03-15T10:30:00Z"));
    expect(result.updatedAt).toEqual(new Date("2026-03-16T12:00:00Z"));
  });
});
