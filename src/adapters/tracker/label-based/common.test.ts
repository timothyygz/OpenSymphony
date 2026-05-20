import { test, expect, describe, mock } from "bun:test";
import {
  SYMPHONY_LABEL_PREFIX,
  DEFAULT_SYMPHONY_LABELS,
  normalizeLabels,
  extractSymphonyState,
  extractNonSymphonyLabels,
  buildMetadataMarker,
  cleanMetadataFromBody,
  appendMetadataToBody,
  fetchIssuesByLabelStates,
  fetchIssuesByIds,
  updateLabelState,
  updateBodyMetadata,
  updateTokens,
  healthCheckSequence,
} from "./common.ts";

describe("normalizeLabels", () => {
  test("normalizes string arrays as-is", () => {
    expect(normalizeLabels(["a", "b"])).toEqual(["a", "b"]);
  });

  test("normalizes {name} objects to strings", () => {
    expect(normalizeLabels([{ name: "a" }, { name: "b" }])).toEqual(["a", "b"]);
  });

  test("returns empty array for empty input", () => {
    expect(normalizeLabels([])).toEqual([]);
  });
});

describe("extractSymphonyState", () => {
  test("extracts state from symphony label", () => {
    expect(extractSymphonyState(["bug", "symphony::In Progress"], SYMPHONY_LABEL_PREFIX, "open")).toBe("In Progress");
  });

  test("returns fallback when no symphony label", () => {
    expect(extractSymphonyState(["bug", "feature"], SYMPHONY_LABEL_PREFIX, "open")).toBe("open");
  });

  test("handles custom prefix", () => {
    expect(extractSymphonyState(["custom::Todo"], "custom::", "open")).toBe("Todo");
  });
});

describe("extractNonSymphonyLabels", () => {
  test("filters out symphony labels", () => {
    expect(extractNonSymphonyLabels(["bug", "symphony::Todo", "feature"], SYMPHONY_LABEL_PREFIX)).toEqual(["bug", "feature"]);
  });

  test("returns all if no symphony labels", () => {
    expect(extractNonSymphonyLabels(["bug", "feature"], SYMPHONY_LABEL_PREFIX)).toEqual(["bug", "feature"]);
  });
});

describe("HTML comment metadata", () => {
  test("buildMetadataMarker", () => {
    expect(buildMetadataMarker("tokens", '{"total":100}')).toBe('<!-- symphony-tokens: {"total":100} -->');
  });

  test("cleanMetadataFromBody removes matching markers", () => {
    const body = "Some text\n\n<!-- symphony-tokens: {\"total\":100} -->\n\nmore text";
    const result = cleanMetadataFromBody(body, "tokens");
    expect(result).not.toContain("symphony-tokens");
    expect(result).toContain("Some text");
    expect(result).toContain("more text");
  });

  test("appendMetadataToBody replaces old and appends new", () => {
    const body = "Description\n\n<!-- symphony-tokens: old -->";
    const result = appendMetadataToBody(body, "tokens", "new");
    expect(result).toContain("<!-- symphony-tokens: new -->");
    expect(result).not.toContain("symphony-tokens: old");
  });
});

describe("fetchIssuesByLabelStates", () => {
  const mockMapFn = (raw: { id: number; title: string }) => ({
    id: String(raw.id),
    identifier: `#${raw.id}`,
    title: raw.title,
    description: null,
    priority: null,
    state: "Todo",
    branchName: null,
    url: null,
    labels: [],
    blockedBy: [],
    createdAt: null,
    updatedAt: null,
  });

  test("returns empty for empty states", async () => {
    const result = await fetchIssuesByLabelStates({
      states: [],
      labelPrefix: SYMPHONY_LABEL_PREFIX,
      listFn: mock(async () => []),
      mapFn: mockMapFn,
      openStateValue: "open",
    });
    expect(result).toEqual([]);
  });

  test("wildcard state fetches all open issues", async () => {
    const listFn = mock(async () => [{ id: 1, title: "Issue 1" }]);
    const result = await fetchIssuesByLabelStates({
      states: ["*"],
      labelPrefix: SYMPHONY_LABEL_PREFIX,
      listFn,
      mapFn: mockMapFn,
      openStateValue: "open",
    });
    expect(result).toHaveLength(1);
    expect(listFn).toHaveBeenCalledWith({ state: "open", per_page: "100" });
  });

  test("deduplicates issues across state queries", async () => {
    const listFn = mock(async (params: Record<string, string>) => {
      // Both states return the same issue
      return [{ id: 1, title: "Issue 1" }];
    });
    const result = await fetchIssuesByLabelStates({
      states: ["Todo", "In Progress"],
      labelPrefix: SYMPHONY_LABEL_PREFIX,
      listFn,
      mapFn: mockMapFn,
      openStateValue: "open",
    });
    expect(result).toHaveLength(1);
    expect(listFn).toHaveBeenCalledTimes(2);
  });
});

describe("fetchIssuesByIds", () => {
  const mockMapFn = (raw: { id: number }) => ({
    id: String(raw.id),
    identifier: `#${raw.id}`,
    title: `Issue ${raw.id}`,
    description: null,
    priority: null,
    state: "Todo",
    branchName: null,
    url: null,
    labels: [],
    blockedBy: [],
    createdAt: null,
    updatedAt: null,
  });

  test("returns empty for empty ids", async () => {
    const result = await fetchIssuesByIds({
      ids: [],
      getFn: mock(async () => ({ id: 1 })),
      mapFn: mockMapFn,
      kind: "test",
    });
    expect(result).toEqual([]);
  });

  test("fetches each issue individually", async () => {
    const getFn = mock(async (id: number) => ({ id }));
    const result = await fetchIssuesByIds({
      ids: ["1", "2"],
      getFn,
      mapFn: mockMapFn,
      kind: "test",
    });
    expect(result).toHaveLength(2);
    expect(getFn).toHaveBeenCalledTimes(2);
  });

  test("continues on individual fetch errors", async () => {
    const getFn = mock(async (id: number) => {
      if (id === 1) throw new Error("not found");
      return { id };
    });
    const result = await fetchIssuesByIds({
      ids: ["1", "2"],
      getFn,
      mapFn: mockMapFn,
      kind: "test",
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("2");
  });
});

describe("updateLabelState", () => {
  test("replaces symphony label with new state", async () => {
    const getFn = mock(async () => ({ labels: ["bug", "symphony::Todo"] }));
    const updateFn = mock(async () => ({}));
    const getLabels = (raw: { labels: string[] }) => raw.labels;
    const buildLabelsParam = (labels: string[]) => labels.join(",");

    await updateLabelState({
      issueId: "1",
      state: "Done",
      labelPrefix: SYMPHONY_LABEL_PREFIX,
      getFn,
      updateFn,
      getLabels,
      buildLabelsParam,
    });

    expect(getFn).toHaveBeenCalledWith(1);
    expect(updateFn).toHaveBeenCalledWith(1, { labels: "bug,symphony::Done" });
  });
});

describe("updateBodyMetadata", () => {
  test("appends metadata marker to body", async () => {
    const getFn = mock(async () => ({ body: "Original description" }));
    const updateFn = mock(async () => ({}));

    await updateBodyMetadata({
      issueId: "1",
      metadataKey: "progress",
      value: "50% done",
      getFn,
      updateFn,
      getBody: (raw: { body: string }) => raw.body,
      buildBodyParam: (body: string) => body,
      kind: "test",
    });

    expect(updateFn).toHaveBeenCalledTimes(1);
    const calls = updateFn.mock.calls as unknown as [number, { body: string }][];
    const body = calls[0]![1].body;
    expect(body).toContain("<!-- symphony-progress: 50% done -->");
  });
});

describe("updateTokens", () => {
  test("replaces old token marker with new one", async () => {
    const getFn = mock(async () => ({ body: "Desc\n\n<!-- symphony-tokens: {\"old\":true} -->" }));
    const updateFn = mock(async () => ({}));

    await updateTokens({
      issueId: "1",
      tokens: { totalTokens: 100, inputTokens: 50, outputTokens: 50 },
      getFn,
      updateFn,
      getBody: (raw: { body: string }) => raw.body,
      buildBodyParam: (body: string) => body,
      kind: "test",
    });

    const calls = updateFn.mock.calls as unknown as [number, { body: string }][];
    const body = calls[0]![1].body;
    expect(body).toContain("<!-- symphony-tokens:");
    expect(body).not.toContain('"old"');
  });
});

describe("healthCheckSequence", () => {
  test("passes both checks on success", async () => {
    const results = await healthCheckSequence({
      connectionTestFn: async () => ({ name: "my-repo" }),
      listFn: async () => [],
      connectivityName: "Connectivity",
      accessName: "Access",
    });
    expect(results).toHaveLength(2);
    expect(results[0]!.status).toBe("pass");
    expect(results[1]!.status).toBe("pass");
  });

  test("stops early on connection failure", async () => {
    const results = await healthCheckSequence({
      connectionTestFn: async () => { throw new Error("timeout"); },
      listFn: async () => [],
      connectivityName: "Connectivity",
      accessName: "Access",
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe("fail");
  });
});
