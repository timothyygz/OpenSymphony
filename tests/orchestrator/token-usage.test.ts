import { test, expect, describe } from "bun:test";
import { addTokenUsage } from "../../src/orchestrator/state.ts";
import type { OrchestratorState } from "../../src/orchestrator/state.ts";
import type { RunningEntry } from "../../src/model/index.ts";
import type { Issue } from "../../src/model/index.ts";

function makeEntry(totalTokens: number): RunningEntry {
  return {
    issue: { id: "test", identifier: "TEST-1", title: "Test", description: null, priority: null, state: "进行中", branchName: null, url: null, labels: [], blockedBy: [], createdAt: null, updatedAt: null } satisfies Issue,
    identifier: "TEST-1",
    sessionId: null,
    codexAppServerPid: null,
    lastCodexEvent: null,
    lastCodexTimestamp: null,
    lastCodexMessage: null,
    tokenUsage: { inputTokens: totalTokens, outputTokens: 0, totalTokens },
    lastReportedTokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    retryAttempt: 0,
    startedAt: new Date(),
    turnCount: 0,
  };
}

describe("addTokenUsage", () => {
  test("accumulates token usage into aggregateTotals", () => {
    const state: OrchestratorState = {
      pollIntervalMs: 30000,
      maxConcurrentAgents: 10,
      running: new Map(),
      claimed: new Set(),
      retryAttempts: new Map(),
      completed: new Set(),
      aggregateTotals: { inputTokens: 0, outputTokens: 0, totalTokens: 0, secondsRunning: 0 },
      rateLimits: null,
      nextTickAt: null,
    };

    addTokenUsage(state, makeEntry(1000));
    expect(state.aggregateTotals.totalTokens).toBe(1000);
    expect(state.aggregateTotals.inputTokens).toBe(1000);

    addTokenUsage(state, makeEntry(2000));
    expect(state.aggregateTotals.totalTokens).toBe(3000);
    expect(state.aggregateTotals.inputTokens).toBe(3000);
  });

  test("accumulates correctly across multiple calls", () => {
    const state: OrchestratorState = {
      pollIntervalMs: 30000,
      maxConcurrentAgents: 10,
      running: new Map(),
      claimed: new Set(),
      retryAttempts: new Map(),
      completed: new Set(),
      aggregateTotals: { inputTokens: 500, outputTokens: 200, totalTokens: 700, secondsRunning: 0 },
      rateLimits: null,
      nextTickAt: null,
    };

    addTokenUsage(state, makeEntry(300));
    expect(state.aggregateTotals.totalTokens).toBe(1000);
    expect(state.aggregateTotals.inputTokens).toBe(800);
  });
});
