import { test, expect, describe } from "bun:test";
import { formatRunningTable, formatBackoffQueue, formatCompletedTable, formatCompactHeader } from "../../src/tui/layout.ts";
import { ANSI, colorize } from "../../src/tui/renderer.ts";
import { Sparkline } from "../../src/tui/sparkline.ts";
import type { OrchestratorState, CompletedEntry } from "../../src/orchestrator/state.ts";
import type { RunningEntry, RetryEntry } from "../../src/model/index.ts";

function makeRunningEntry(overrides: Partial<RunningEntry> = {}): RunningEntry {
  return {
    issue: { id: "issue-1", title: "Test Issue", state: "in_progress", ...overrides.issue },
    identifier: "MT-001",
    sessionId: null,
    agentPid: null,
    lastAgentEvent: "content_block_delta",
    lastAgentTimestamp: null,
    lastAgentMessage: null,
    tokenUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    lastReportedTokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    retryAttempt: 0,
    startedAt: new Date(Date.now() - 60000),
    turnCount: 3,
    ...overrides,
  };
}

function makeRetryEntry(overrides: Partial<RetryEntry> = {}): RetryEntry {
  return {
    identifier: "MT-002",
    dueAtMs: Date.now() + 30000,
    attempt: 1,
    error: "connection timeout",
    ...overrides,
  };
}

function makeState(overrides: Partial<OrchestratorState> = {}): OrchestratorState {
  return {
    pollIntervalMs: 30000,
    maxConcurrentAgents: 5,
    running: new Map(),
    claimed: new Set(),
    retryAttempts: new Map(),
    completed: new Set(),
    recentCompleted: [],
    aggregateTotals: { inputTokens: 0, outputTokens: 0, totalTokens: 0, secondsRunning: 0 },
    rateLimits: null,
    nextTickAt: null,
    ...overrides,
  };
}

describe("formatRunningTable", () => {
  test("shows empty state when no agents running", () => {
    const state = makeState();
    const lines = formatRunningTable(state);
    expect(lines.some((l) => l.includes("No active agents"))).toBe(true);
  });

  test("shows header row with column names", () => {
    const state = makeState();
    const lines = formatRunningTable(state);
    const hasHeader = lines.some((l) => l.includes("ID") && l.includes("TITLE") && l.includes("STATE"));
    expect(hasHeader).toBe(true);
  });

  test("renders a single running agent", () => {
    const entry = makeRunningEntry();
    const state = makeState({
      running: new Map([["issue-1", entry]]),
    });
    const lines = formatRunningTable(state);
    expect(lines.some((l) => l.includes("MT-001"))).toBe(true);
    expect(lines.some((l) => l.includes("Test Issue"))).toBe(true);
  });

  test("renders multiple running agents sorted by identifier", () => {
    const entry1 = makeRunningEntry({ identifier: "MT-002", issue: { id: "issue-2", title: "Issue B", state: "in_progress" } });
    const entry2 = makeRunningEntry({ identifier: "MT-001", issue: { id: "issue-1", title: "Issue A", state: "in_progress" } });
    const state = makeState({
      running: new Map([
        ["issue-1", entry2],
        ["issue-2", entry1],
      ]),
    });
    const lines = formatRunningTable(state);
    const idx001 = lines.findIndex((l) => l.includes("MT-001"));
    const idx002 = lines.findIndex((l) => l.includes("MT-002"));
    expect(idx001).toBeLessThan(idx002);
  });

  test("shows progress bar for agents with turns", () => {
    const entry = makeRunningEntry({ turnCount: 3 });
    const state = makeState({
      running: new Map([["issue-1", entry]]),
    });
    const lines = formatRunningTable(state);
    const row = lines.find((l) => l.includes("MT-001"));
    expect(row).toBeDefined();
    expect(row!.includes("▓") || row!.includes("░")).toBe(true);
  });
});

describe("formatBackoffQueue", () => {
  test("shows empty state when no retries", () => {
    const state = makeState();
    const lines = formatBackoffQueue(state);
    expect(lines.some((l) => l.includes("No queued retries"))).toBe(true);
  });

  test("renders a retry entry", () => {
    const retry = makeRetryEntry();
    const state = makeState({
      retryAttempts: new Map([["issue-2", retry]]),
    });
    const lines = formatBackoffQueue(state);
    expect(lines.some((l) => l.includes("MT-002"))).toBe(true);
    expect(lines.some((l) => l.includes("attempt=1"))).toBe(true);
  });

  test("shows error message when present", () => {
    const retry = makeRetryEntry({ error: "connection refused" });
    const state = makeState({
      retryAttempts: new Map([["issue-2", retry]]),
    });
    const lines = formatBackoffQueue(state);
    expect(lines.some((l) => l.includes("connection refused"))).toBe(true);
  });

  test("omits error section when error is empty", () => {
    const retry = makeRetryEntry({ error: "" });
    const state = makeState({
      retryAttempts: new Map([["issue-2", retry]]),
    });
    const lines = formatBackoffQueue(state);
    expect(lines.every((l) => !l.includes("error="))).toBe(true);
  });
});

describe("formatCompletedTable", () => {
  test("returns empty array when no completed entries", () => {
    const state = makeState();
    const lines = formatCompletedTable(state);
    expect(lines).toEqual([]);
  });

  test("renders completed entries", () => {
    const completed: CompletedEntry[] = [
      {
        identifier: "MT-001",
        title: "Done Task",
        totalTokens: 15000,
        turns: 5,
        runtimeSeconds: 300,
        completedAt: new Date(),
      },
    ];
    const state = makeState({ recentCompleted: completed });
    const lines = formatCompletedTable(state);
    expect(lines.some((l) => l.includes("Recently Completed"))).toBe(true);
    expect(lines.some((l) => l.includes("MT-001"))).toBe(true);
    expect(lines.some((l) => l.includes("Done Task"))).toBe(true);
  });

  test("renders multiple completed entries", () => {
    const completed: CompletedEntry[] = [
      { identifier: "MT-001", title: "Task A", totalTokens: 1000, turns: 2, runtimeSeconds: 60, completedAt: new Date() },
      { identifier: "MT-002", title: "Task B", totalTokens: 2000, turns: 4, runtimeSeconds: 120, completedAt: new Date() },
    ];
    const state = makeState({ recentCompleted: completed });
    const lines = formatCompletedTable(state);
    expect(lines.some((l) => l.includes("MT-001"))).toBe(true);
    expect(lines.some((l) => l.includes("MT-002"))).toBe(true);
  });
});

describe("formatRunningTable overflow", () => {
  function makeNEntries(n: number): Map<string, RunningEntry> {
    const map = new Map<string, RunningEntry>();
    for (let i = 0; i < n; i++) {
      const id = String(i).padStart(3, "0");
      map.set(`issue-${id}`, makeRunningEntry({
        identifier: `MT-${id}`,
        issue: { id: `issue-${id}`, title: `Task ${id}`, state: "in_progress" },
      }));
    }
    return map;
  }

  test("shows all agents when no height constraint", () => {
    const state = makeState({ running: makeNEntries(5) });
    const lines = formatRunningTable(state);
    expect(lines.some((l) => l.includes("MT-000"))).toBe(true);
    expect(lines.some((l) => l.includes("MT-004"))).toBe(true);
    expect(lines.some((l) => l.includes("more"))).toBe(false);
  });

  test("truncates when maxHeight is smaller than agent count", () => {
    const state = makeState({ running: makeNEntries(10) });
    const lines = formatRunningTable(state, 7);
    // chromeLines=4, so available=7-4=3 agents visible, overflow=10-3=7
    expect(lines.some((l) => l.includes("+7 more"))).toBe(true);
  });

  test("shows at least 1 agent even with minimal height", () => {
    const state = makeState({ running: makeNEntries(5) });
    const lines = formatRunningTable(state, 5);
    expect(lines.some((l) => l.includes("MT-"))).toBe(true);
    expect(lines.some((l) => l.includes("more"))).toBe(true);
  });
});

describe("formatCompactHeader", () => {
  test("renders a single-line compact header", () => {
    const state = makeState({
      running: new Map([["issue-1", makeRunningEntry()]]),
      maxConcurrentAgents: 5,
      completed: new Set(["issue-old"]),
      aggregateTotals: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500, secondsRunning: 300 },
    });
    const sparkline = new Sparkline();
    const lines = formatCompactHeader(state, sparkline, Date.now());

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("1/5");
    expect(lines[0]).toContain("agents");
    expect(lines[0]).toContain("done");
    expect(lines[0]).toContain("tps");
    expect(lines[0]).toContain("tokens");
  });

  test("shows zero agents", () => {
    const state = makeState();
    const sparkline = new Sparkline();
    const lines = formatCompactHeader(state, sparkline, Date.now());

    expect(lines[0]).toContain("0/5");
    expect(lines[0]).toContain("done");
  });
});
