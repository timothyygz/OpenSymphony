import { test, expect, describe } from "bun:test";
import { createInitialState, addRuntimeSeconds, addTokenUsage, normalizeState, isActiveState, isTerminalState } from "../../src/orchestrator/state.ts";
import type { OrchestratorState } from "../../src/orchestrator/state.ts";
import type { RunningEntry, Issue } from "../../src/model/index.ts";

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "issue-1",
    identifier: "TEST-1",
    title: "Test issue",
    description: null,
    priority: null,
    state: "待处理",
    branchName: null,
    url: null,
    labels: [],
    blockedBy: [],
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function makeEntry(overrides: Partial<RunningEntry> = {}): RunningEntry {
  return {
    issue: makeIssue(),
    identifier: "TEST-1",
    sessionId: null,
    agentPid: null,
    lastAgentEvent: null,
    lastAgentTimestamp: null,
    lastAgentMessage: null,
    tokenUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    lastReportedTokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    retryAttempt: 0,
    startedAt: new Date(),
    turnCount: 3,
    ...overrides,
  };
}

describe("normalizeState", () => {
  test("trims whitespace", () => {
    expect(normalizeState("  进行中  ")).toBe("进行中");
    expect(normalizeState("待处理")).toBe("待处理");
  });
});

describe("isActiveState", () => {
  test("matches trimmed states", () => {
    expect(isActiveState("待处理", ["待处理", "进行中"])).toBe(true);
    expect(isActiveState(" 进行中 ", ["待处理", "进行中"])).toBe(true);
    expect(isActiveState("已完成", ["待处理", "进行中"])).toBe(false);
  });
});

describe("isTerminalState", () => {
  test("matches trimmed states", () => {
    expect(isTerminalState("已完成", ["已完成", "已取消"])).toBe(true);
    expect(isTerminalState(" 已取消 ", ["已完成", "已取消"])).toBe(true);
    expect(isTerminalState("待处理", ["已完成", "已取消"])).toBe(false);
  });
});

describe("addRuntimeSeconds", () => {
  test("accumulates elapsed seconds", () => {
    const state = createInitialState();
    const entry = makeEntry({ startedAt: new Date(Date.now() - 60000) });
    addRuntimeSeconds(state, entry);
    expect(state.aggregateTotals.secondsRunning).toBeGreaterThanOrEqual(60);
    expect(state.aggregateTotals.secondsRunning).toBeLessThan(62);
  });
});

describe("addTokenUsage", () => {
  test("accumulates token usage", () => {
    const state = createInitialState();
    const entry = makeEntry();
    addTokenUsage(state, entry);
    expect(state.aggregateTotals.inputTokens).toBe(100);
    expect(state.aggregateTotals.outputTokens).toBe(50);
    expect(state.aggregateTotals.totalTokens).toBe(150);
  });
});

describe("effectiveSecondsRunning", () => {
  test("combines ended and active seconds", () => {
    const state = createInitialState();
    state.aggregateTotals.secondsRunning = 100;
    const entry = makeEntry({ startedAt: new Date(Date.now() - 30000) });
    state.running.set("issue-1", entry);

    const { effectiveSecondsRunning } = require("../../src/orchestrator/state.ts") as typeof import("../../src/orchestrator/state.ts");
    const effective = effectiveSecondsRunning(state);
    expect(effective).toBeGreaterThanOrEqual(130);
    expect(effective).toBeLessThan(132);
  });
});
