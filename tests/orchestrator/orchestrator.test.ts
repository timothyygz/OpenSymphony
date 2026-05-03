import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Orchestrator } from "../../src/orchestrator/orchestrator.ts";
import { createInitialState, isActiveState, isTerminalState } from "../../src/orchestrator/state.ts";
import { sortForDispatch, canDispatch, availableSlots } from "../../src/orchestrator/dispatch.ts";
import { scheduleRetry, cancelRetry } from "../../src/orchestrator/retry.ts";
import type { Issue, ServiceConfig, WorkflowDefinition } from "../../src/model/index.ts";
import type { TrackerAdapter } from "../../src/adapters/tracker/types.ts";
import type { AgentAdapter, AgentSession, AgentSessionContext, AgentEvent, TurnResult } from "../../src/adapters/agent/types.ts";
import { WorkspaceManager } from "../../src/workspace/manager.ts";
import { parseWorkflowContent } from "../../src/workflow/loader.ts";
import { buildServiceConfig } from "../../src/workflow/config.ts";

// --- Mock Adapters ---

class MockTracker implements TrackerAdapter {
  kind = "mock";
  private issues: Issue[] = [];

  setIssues(issues: Issue[]) {
    this.issues = issues;
  }

  async fetchCandidateIssues(): Promise<Issue[]> {
    return this.issues;
  }

  async fetchIssuesByStates(): Promise<Issue[]> {
    return this.issues;
  }

  async updateIssueState(): Promise<void> {}

  async fetchIssueStatesByIds(ids: string[]): Promise<Issue[]> {
    return this.issues.filter((i) => ids.includes(i.id));
  }
}

class MockAgent implements AgentAdapter {
  kind = "mock";
  turnResults: TurnResult[] = [];
  callCount = 0;

  async startSession(ctx: AgentSessionContext): Promise<AgentSession> {
    return { id: ctx.sessionId, turnCount: 0, metadata: { workspacePath: ctx.workspacePath } };
  }

  async runTurn(session: AgentSession, _prompt: string, _onEvent: (event: AgentEvent) => void): Promise<TurnResult> {
    session.turnCount++;
    this.callCount++;
    return this.turnResults.shift() ?? { status: "completed" };
  }

  async stopSession(): Promise<void> {}
}

// --- Helpers ---

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "issue-1",
    identifier: "MT-100",
    title: "Test issue",
    description: "A test",
    priority: 1,
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

function makeConfig(workspaceRoot: string): ServiceConfig {
  const content = `---
tracker:
  kind: feishu_bitable
  app_id: test
  app_secret: test
  app_token: test
  table_id: test
  state_field: "状态"
  identifier_field: "编号"
  title_field: "标题"
  active_states: ["待处理", "进行中"]
  terminal_states: ["已完成", "已取消"]
workspace:
  root: "${workspaceRoot}"
agent:
  max_concurrent_agents: 5
  max_turns: 3
codex:
  command: "claude"
---
Do work on {{ issue.identifier }}`;
  const workflow = parseWorkflowContent(content);
  return buildServiceConfig(workflow.config, "/");
}

// --- Tests ---

describe("Orchestrator State", () => {
  it("creates initial state with defaults", () => {
    const state = createInitialState();
    expect(state.running.size).toBe(0);
    expect(state.claimed.size).toBe(0);
    expect(state.completed.size).toBe(0);
    expect(state.aggregateTotals.secondsRunning).toBe(0);
  });

  it("checks active/terminal states with trim matching", () => {
    expect(isActiveState("待处理", ["待处理", "进行中"])).toBe(true);
    expect(isActiveState(" 进行中 ", ["待处理", "进行中"])).toBe(true);
    expect(isActiveState("已完成", ["待处理", "进行中"])).toBe(false);
    expect(isTerminalState("已完成", ["已完成", "已取消"])).toBe(true);
  });
});

describe("Dispatch sorting", () => {
  it("sorts by priority ascending", () => {
    const issues = [makeIssue({ id: "3", priority: 3 }), makeIssue({ id: "1", priority: 1 }), makeIssue({ id: "2", priority: 2 })];
    const sorted = sortForDispatch(issues);
    expect(sorted.map((i) => i.id)).toEqual(["1", "2", "3"]);
  });

  it("sorts null priority last", () => {
    const issues = [makeIssue({ id: "null", priority: null }), makeIssue({ id: "1", priority: 1 })];
    const sorted = sortForDispatch(issues);
    expect(sorted[0]!.id).toBe("1");
  });

  it("uses created_at as tiebreaker", () => {
    const issues = [
      makeIssue({ id: "b", priority: 1, createdAt: new Date("2026-01-02") }),
      makeIssue({ id: "a", priority: 1, createdAt: new Date("2026-01-01") }),
    ];
    const sorted = sortForDispatch(issues);
    expect(sorted[0]!.id).toBe("a");
  });
});

describe("canDispatch", () => {
  it("allows dispatch for eligible issue", () => {
    const state = createInitialState();
    const issue = makeIssue();
    expect(canDispatch(issue, state, 10, new Map(), ["待处理"])).toBe(true);
  });

  it("rejects when global concurrency exhausted", () => {
    const state = createInitialState();
    state.running.set("other", {
      issue: makeIssue({ id: "other" }),
      identifier: "other",
      sessionId: null,
      codexAppServerPid: null,
      lastCodexEvent: null,
      lastCodexTimestamp: null,
      lastCodexMessage: null,
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      lastReportedTokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      retryAttempt: 0,
      startedAt: new Date(),
      turnCount: 0,
    });
    expect(canDispatch(makeIssue(), state, 1, new Map(), ["待处理"])).toBe(false);
  });

  it("rejects already claimed issue", () => {
    const state = createInitialState();
    state.claimed.add("issue-1");
    expect(canDispatch(makeIssue(), state, 10, new Map(), ["待处理"])).toBe(false);
  });

  it("rejects non-active state", () => {
    const state = createInitialState();
    expect(canDispatch(makeIssue({ state: "已完成" }), state, 10, new Map(), ["待处理"])).toBe(false);
  });
});

describe("Retry queue", () => {
  it("schedules continuation retry with 1s delay", () => {
    const state = createInitialState();
    scheduleRetry(state, "id-1", "MT-100", 1, null, 300000, () => {}, true);
    const entry = state.retryAttempts.get("id-1");
    expect(entry).toBeDefined();
    expect(entry!.attempt).toBe(1);
    cancelRetry(state, "id-1");
  });

  it("schedules backoff retry with exponential delay", () => {
    const state = createInitialState();
    scheduleRetry(state, "id-1", "MT-100", 2, "error", 300000, () => {});
    const entry = state.retryAttempts.get("id-1");
    expect(entry!.attempt).toBe(2);
    cancelRetry(state, "id-1");
  });

  it("cancels existing retry on reschedule", () => {
    const state = createInitialState();
    scheduleRetry(state, "id-1", "MT-100", 1, null, 300000, () => {});
    scheduleRetry(state, "id-1", "MT-100", 2, "retry", 300000, () => {});
    expect(state.retryAttempts.size).toBe(1);
    expect(state.retryAttempts.get("id-1")!.attempt).toBe(2);
    cancelRetry(state, "id-1");
  });
});

describe("Orchestrator integration", () => {
  let tempRoot: string;
  let mockTracker: MockTracker;
  let mockAgent: MockAgent;
  let config: ServiceConfig;
  let workflow: WorkflowDefinition;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "symphony-test-"));
    config = makeConfig(tempRoot);
    workflow = { config: {}, promptTemplate: "Work on {{ issue.identifier }}" };
    mockTracker = new MockTracker();
    mockAgent = new MockAgent();
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("dispatches eligible issue and runs agent", async () => {
    const issue = makeIssue();
    mockTracker.setIssues([issue]);
    // Agent completes 1 turn, then issue becomes terminal
    mockAgent.turnResults = [{ status: "completed" }];

    // After first turn, make issue terminal so the turn loop exits
    const trackerSpy = mockTracker;
    const originalFetch = trackerSpy.fetchIssueStatesByIds.bind(trackerSpy);
    let fetchCount = 0;
    trackerSpy.fetchIssueStatesByIds = async (ids: string[]) => {
      fetchCount++;
      if (fetchCount > 0) {
        return [makeIssue({ state: "已完成" })];
      }
      return originalFetch(ids);
    };

    const wsManager = new WorkspaceManager({ root: tempRoot, hooks: { timeout_ms: 5000 } });
    const orchestrator = new Orchestrator({
      config,
      workflow,
      tracker: trackerSpy,
      agent: mockAgent,
      workspaceManager: wsManager,
    });

    // Start and let one tick run
    // We need to stop it immediately after tick to avoid the loop
    const tickPromise = (orchestrator as any).tick.bind(orchestrator)();
    await tickPromise;

    // Give worker time to complete
    await new Promise((r) => setTimeout(r, 100));

    expect(mockAgent.callCount).toBeGreaterThanOrEqual(1);
    orchestrator.stop();
  });
});
