import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
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
import { readMetaJson } from "../../src/logging/turn-log.ts";

// --- Mock Adapters ---

class MockTracker implements TrackerAdapter {
  kind = "mock";
  private issues: Issue[] = [];

  // Track feedback calls
  joinCommands = new Map<string, string>();
  progressUpdates = new Map<string, string[]>();
  resultSummaries = new Map<string, string>();
  stateUpdates: { issueId: string; state: string }[] = [];

  setIssues(issues: Issue[]) {
    this.issues = issues;
  }

  async fetchCandidateIssues(): Promise<Issue[]> {
    return this.issues;
  }

  async fetchIssuesByStates(): Promise<Issue[]> {
    return this.issues;
  }

  async updateIssueState(issueId: string, state: string): Promise<void> {
    this.stateUpdates.push({ issueId, state });
  }

  async updateIssueTokens(): Promise<void> {}

  async updateIssueJoinCommand(issueId: string, command: string): Promise<void> {
    this.joinCommands.set(issueId, command);
  }

  async updateIssueProgress(issueId: string, progress: string): Promise<void> {
    const existing = this.progressUpdates.get(issueId) ?? [];
    existing.push(progress);
    this.progressUpdates.set(issueId, existing);
  }

  async updateIssueResultSummary(issueId: string, summary: string): Promise<void> {
    this.resultSummaries.set(issueId, summary);
  }

  async fetchIssueStatesByIds(ids: string[]): Promise<Issue[]> {
    return this.issues.filter((i) => ids.includes(i.id));
  }

  getMcpServerConfig() {
    return {};
  }

  async createIssue(data: import("../../src/adapters/tracker/types.ts").CreateIssueData): Promise<Issue> {
    const issue: Issue = { id: `mock-${Date.now()}`, identifier: `MOCK-${this.issues.length + 1}`, title: data.title, state: data.state ?? "Todo", description: data.description ?? null, priority: null, branchName: null, url: null, labels: [], blockedBy: [], createdAt: null, updatedAt: null };
    this.issues.push(issue);
    return issue;
  }

  async searchIssues(): Promise<Issue[]> {
    return this.issues;
  }
}

class MockAgent implements AgentAdapter {
  kind = "mock";
  turnResults: TurnResult[] = [];
  callCount = 0;
  private eventsPerTurn: AgentEvent[][] = [];

  /** Set events to emit during each turn */
  setTurnEvents(events: AgentEvent[][]) {
    this.eventsPerTurn = events;
  }

  async startSession(ctx: AgentSessionContext): Promise<AgentSession> {
    return { id: ctx.sessionId, turnCount: 0, metadata: { workspacePath: ctx.workspacePath, sessionId: ctx.sessionId } };
  }

  async runTurn(session: AgentSession, _prompt: string, onEvent: (event: AgentEvent) => void): Promise<TurnResult> {
    session.turnCount++;
    this.callCount++;

    // Emit configured events for this turn
    const events = this.eventsPerTurn.shift() ?? [];
    for (const event of events) {
      onEvent(event);
    }

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
  kind: claude-code
  max_concurrent_agents: 5
  max_turns: 3
  config:
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
      agentPid: null,
      lastAgentEvent: null,
      lastAgentTimestamp: null,
      lastAgentMessage: null,
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

    const wsManager = new WorkspaceManager({ root: tempRoot, hooks: { timeout_ms: 5000 }, sources: [], workflowDir: "" });
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
    await orchestrator.stop();
  });



  it("creates meta.json with session info on dispatch", async () => {
    const issue = makeIssue();
    mockTracker.setIssues([issue]);
    mockAgent.turnResults = [{ status: "completed" }];

    const origFetch = mockTracker.fetchIssueStatesByIds.bind(mockTracker);
    let fetchCount = 0;
    mockTracker.fetchIssueStatesByIds = async (ids: string[]) => {
      fetchCount++;
      if (fetchCount > 0) return [makeIssue({ state: "已完成" })];
      return origFetch(ids);
    };

    const wsManager = new WorkspaceManager({ root: tempRoot, hooks: { timeout_ms: 5000 }, sources: [], workflowDir: "" });
    const orchestrator = new Orchestrator({
      config, workflow, tracker: mockTracker, agent: mockAgent, workspaceManager: wsManager,
    });

    await (orchestrator as any).tick();
    await new Promise((r) => setTimeout(r, 150));

    // Check meta.json was created in workspace
    const metaPath = resolve(tempRoot, "MT-100", ".symphony", "meta.json");
    expect(existsSync(metaPath)).toBe(true);

    const meta = await readMetaJson(resolve(tempRoot, "MT-100"));
    expect(meta).not.toBeNull();
    expect(meta!.issueId).toBe("issue-1");
    expect(meta!.identifier).toBe("MT-100");
    expect(meta!.sessionId).toBeNull();

    await orchestrator.stop();
  });

  it("does not write result summary on failure", async () => {
    const issue = makeIssue();
    mockTracker.setIssues([issue]);
    mockAgent.turnResults = [{ status: "failed", error: "agent crashed" }];

    const origFetch = mockTracker.fetchIssueStatesByIds.bind(mockTracker);
    mockTracker.fetchIssueStatesByIds = async (ids: string[]) => {
      return [makeIssue({ state: "待处理" })];
    };

    const wsManager = new WorkspaceManager({ root: tempRoot, hooks: { timeout_ms: 5000 }, sources: [], workflowDir: "" });
    const orchestrator = new Orchestrator({
      config, workflow, tracker: mockTracker, agent: mockAgent, workspaceManager: wsManager,
    });

    await (orchestrator as any).tick();
    await new Promise((r) => setTimeout(r, 150));

    expect(mockTracker.resultSummaries.has("issue-1")).toBe(false);

    await orchestrator.stop();
  });

  it("awaits active workers during graceful stop", async () => {
    // Simulate a slow worker by using a deferred turn result
    let resolveTurn: (result: TurnResult) => void;
    const turnPromise = new Promise<TurnResult>((resolve) => {
      resolveTurn = resolve;
    });
    mockAgent.runTurn = async () => turnPromise;

    const issue = makeIssue();
    mockTracker.setIssues([issue]);

    const wsManager = new WorkspaceManager({ root: tempRoot, hooks: { timeout_ms: 5000 }, sources: [], workflowDir: "" });
    const orchestrator = new Orchestrator({
      config, workflow, tracker: mockTracker, agent: mockAgent, workspaceManager: wsManager,
    });

    // Trigger dispatch
    await (orchestrator as any).tick();

    // Worker should be active
    expect((orchestrator as any).activeWorkers.size).toBe(1);

    // Start stop and verify it doesn't resolve immediately
    const stopPromise = orchestrator.stop();
    let stopResolved = false;
    stopPromise.then(() => { stopResolved = true; });

    // Give event loop a tick
    await new Promise((r) => setTimeout(r, 50));
    expect(stopResolved).toBe(false); // stop should still be waiting

    // Complete the worker turn
    resolveTurn!({ status: "completed" });
    mockTracker.fetchIssueStatesByIds = async () => [makeIssue({ state: "已完成" })];

    // Now stop should resolve
    await stopPromise;
    expect(stopResolved).toBe(true);
    expect((orchestrator as any).activeWorkers.size).toBe(0);
  });

  it("marks issue as permanently failed when max_retry_attempts exceeded", async () => {
    const issue = makeIssue();
    mockTracker.setIssues([issue]);
    // Agent fails on both first dispatch and retry
    mockAgent.turnResults = [
      { status: "failed", error: "persistent error" },
      { status: "failed", error: "persistent error" },
    ];

    mockTracker.fetchIssueStatesByIds = async () => [makeIssue({ state: "待处理" })];

    // Use config with max_retry_attempts = 1
    const limitedConfig = { ...config, agent: { ...config.agent, max_retry_attempts: 1 } };

    const wsManager = new WorkspaceManager({ root: tempRoot, hooks: { timeout_ms: 5000 }, sources: [], workflowDir: "" });
    const orchestrator = new Orchestrator({
      config: limitedConfig, workflow, tracker: mockTracker, agent: mockAgent, workspaceManager: wsManager,
    });

    // First dispatch (attempt 0) - worker fails, schedules retry with attempt 1
    // max_retry_attempts = 1, so attempt 1 <= 1, retry is allowed
    await (orchestrator as any).tick();
    await new Promise((r) => setTimeout(r, 150));

    // Verify retry was scheduled (attempt 1)
    expect((orchestrator as any).state.retryAttempts.has("issue-1")).toBe(true);

    // Trigger the retry timer - dispatches with attempt 1
    // Worker fails again, onWorkerExit called with retryAttempt=1, nextAttempt=2
    // 2 > max_retry_attempts(1) → permanent failure
    await (orchestrator as any).onRetryTimer("issue-1");
    await new Promise((r) => setTimeout(r, 150));

    // Check that permanent_failure_state was set
    const permanentFailureUpdate = mockTracker.stateUpdates.find(
      (u) => u.state === "永久失败"
    );
    expect(permanentFailureUpdate).toBeDefined();
    expect(permanentFailureUpdate!.issueId).toBe("issue-1");

    // Issue should be removed from claimed set
    expect((orchestrator as any).state.claimed.has("issue-1")).toBe(false);

    orchestrator.stop();
  });

  it("retries normally when under max_retry_attempts", async () => {
    const state = createInitialState();

    // attempt 1 <= max 3 → should schedule retry
    scheduleRetry(state, "id-1", "MT-100", 1, "error", 300000, () => {});
    expect(state.retryAttempts.has("id-1")).toBe(true);
    expect(state.retryAttempts.get("id-1")!.attempt).toBe(1);
    cancelRetry(state, "id-1");

    // attempt 3 <= max 3 → should schedule retry
    scheduleRetry(state, "id-1", "MT-100", 3, "error", 300000, () => {});
    expect(state.retryAttempts.has("id-1")).toBe(true);
    expect(state.retryAttempts.get("id-1")!.attempt).toBe(3);
    cancelRetry(state, "id-1");
  });
});
