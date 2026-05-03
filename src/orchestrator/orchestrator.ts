import type { ServiceConfig, Issue, RunningEntry, WorkflowDefinition } from "../model/index.ts";
import type { TrackerAdapter } from "../adapters/tracker/types.ts";
import type { AgentAdapter, AgentEvent, AgentSession } from "../adapters/agent/types.ts";
import { WorkspaceManager } from "../workspace/manager.ts";
import { renderTemplate, buildContinuationGuidance } from "../workflow/prompt.ts";
import { runHookIfConfigured, runHookBestEffort } from "../workspace/hooks.ts";
import { createInitialState, isActiveState, isTerminalState, addRuntimeSeconds, addTokenUsage } from "./state.ts";
import type { OrchestratorState } from "./state.ts";
import { sortForDispatch, canDispatch, availableSlots } from "./dispatch.ts";
import { scheduleRetry, cancelRetry } from "./retry.ts";
import { validateDispatchConfig } from "../workflow/config.ts";
import { logger } from "../logging/logger.ts";
import type { ExecutionLog } from "../logging/execution-log.ts";
import type { TokenLog } from "../metrics/token-log.ts";

export interface OrchestratorDeps {
  config: ServiceConfig;
  workflow: WorkflowDefinition;
  tracker: TrackerAdapter;
  agent: AgentAdapter;
  workspaceManager: WorkspaceManager;
  tokenLog?: TokenLog;
  executionLog?: ExecutionLog;
}

export class Orchestrator {
  private state: OrchestratorState;
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private running = true;

  constructor(private readonly deps: OrchestratorDeps) {
    this.state = createInitialState();
    this.applyConfig(deps.config);
  }

  async start(): Promise<void> {
    logger.info("Orchestrator starting");

    // Startup terminal workspace cleanup
    await this.startupCleanup();

    // Immediate first tick
    await this.tick();

    // Schedule subsequent ticks
    this.scheduleTick();
  }

  stop(): void {
    this.running = false;
    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
    logger.info("Orchestrator stopped");
  }

  updateConfig(config: ServiceConfig, workflow: WorkflowDefinition): void {
    this.deps.config = config;
    this.deps.workflow = workflow;
    this.applyConfig(config);
    logger.info("Orchestrator config updated");
  }

  getState(): OrchestratorState {
    return this.state;
  }

  // --- Private ---

  private applyConfig(config: ServiceConfig): void {
    this.state.pollIntervalMs = config.polling.interval_ms;
    this.state.maxConcurrentAgents = config.agent.max_concurrent_agents;
  }

  private scheduleTick(): void {
    if (!this.running) return;
    this.state.nextTickAt = Date.now() + this.state.pollIntervalMs;
    this.tickTimer = setTimeout(() => {
      this.tick().then(() => this.scheduleTick());
    }, this.state.pollIntervalMs);
  }

  // T26: Poll tick main loop
  private async tick(): Promise<void> {
    try {
      // Step 1: Reconcile running issues
      this.reconcileStalled();
      await this.reconcileTrackerStates();

      // Step 2: Dispatch preflight validation
      const validationError = validateDispatchConfig(this.deps.config);
      if (validationError) {
        logger.error({ error: validationError }, "Dispatch validation failed, skipping dispatch");
        return;
      }

      // Step 3: Fetch candidate issues
      let issues: Issue[];
      try {
        issues = await this.deps.tracker.fetchCandidateIssues();
      } catch (err) {
        logger.error({ error: String(err) }, "Failed to fetch candidate issues");
        return;
      }

      // Step 4: Sort for dispatch
      const sorted = sortForDispatch(issues);

      // Step 5: Dispatch eligible issues
      const perStateMap = new Map(
        Object.entries(this.deps.config.agent.max_concurrent_agents_by_state),
      );

      for (const issue of sorted) {
        if (availableSlots(this.state, this.state.maxConcurrentAgents) <= 0) break;

        if (canDispatch(issue, this.state, this.state.maxConcurrentAgents, perStateMap, this.deps.config.tracker.active_states)) {
          this.dispatchIssue(issue, null);
        }
      }
    } catch (err) {
      logger.error({ error: String(err) }, "Tick error");
    }
  }

  // T27: Dispatch one issue
  private dispatchIssue(issue: Issue, attempt: number | null): void {
    const sessionId = `${issue.identifier}-${Date.now()}`;

    const entry: RunningEntry = {
      issue,
      identifier: issue.identifier,
      sessionId: null,
      agentPid: null,
      lastAgentEvent: null,
      lastAgentTimestamp: null,
      lastAgentMessage: null,
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      lastReportedTokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      retryAttempt: attempt ?? 0,
      startedAt: new Date(),
      turnCount: 0,
    };

    this.state.running.set(issue.id, entry);
    this.state.claimed.add(issue.id);
    cancelRetry(this.state, issue.id);

    // Distributed lock: mark issue as in-progress so other instances skip it
    const fromState = issue.state;
    this.deps.tracker.updateIssueState(issue.id, this.deps.config.agent.in_progress_state).catch((err) => {
      logger.warn({ issueId: issue.id, error: String(err) }, "Failed to mark issue as in-progress");
    });
    this.deps.executionLog?.append({
      event: "tracker_state_updated",
      timestamp: new Date().toISOString(),
      issueId: issue.id,
      identifier: issue.identifier,
      fromState,
      toState: this.deps.config.agent.in_progress_state,
    });

    logger.info({ issueId: issue.id, identifier: issue.identifier, attempt }, "Dispatching issue");

    this.deps.executionLog?.append({
      event: "dispatch",
      timestamp: new Date().toISOString(),
      issueId: issue.id,
      identifier: issue.identifier,
      attempt: attempt ?? 0,
    });

    // Run worker in background
    this.runWorker(issue, attempt, sessionId).catch((err) => {
      logger.error({ issueId: issue.id, error: String(err) }, "Worker spawn failed");
      this.deps.executionLog?.append({
        event: "worker_spawn_failed",
        timestamp: new Date().toISOString(),
        issueId: issue.id,
        identifier: issue.identifier,
        error: String(err),
      });
      this.state.running.delete(issue.id);
      this.state.claimed.delete(issue.id);
      // Reset state so retry can re-dispatch
      this.deps.tracker.updateIssueState(issue.id, this.deps.config.agent.active_reset_state).catch(() => {});
      this.deps.executionLog?.append({
        event: "retry_scheduled",
        timestamp: new Date().toISOString(),
        issueId: issue.id,
        identifier: issue.identifier,
        attempt: (attempt ?? 0) + 1,
        backoffMs: this.deps.config.agent.max_retry_backoff_ms,
        reason: String(err),
      });
      scheduleRetry(
        this.state,
        issue.id,
        issue.identifier,
        (attempt ?? 0) + 1,
        String(err),
        this.deps.config.agent.max_retry_backoff_ms,
        (id) => this.onRetryTimer(id),
      );
    });
  }

  // T28: Worker attempt flow
  private async runWorker(issue: Issue, attempt: number | null, sessionId: string): Promise<void> {
    const { config, workflow, agent, workspaceManager } = this.deps;
    const hooks = config.hooks;
    let session: AgentSession | null = null;

    try {
      // Create/reuse workspace
      const workspace = workspaceManager.createForIssue(issue.identifier);

      // before_run hook
      await runHookIfConfigured("before_run", hooks, workspace.path);

      // Start agent session
      session = await agent.startSession({
        workspacePath: workspace.path,
        issue,
        sessionId,
        config: (config as unknown) as Record<string, unknown>,
      });

      // Update running entry with session info
      const entry = this.state.running.get(issue.id);
      if (entry) entry.sessionId = sessionId;

      this.deps.executionLog?.append({
        event: "session_started",
        timestamp: new Date().toISOString(),
        issueId: issue.id,
        identifier: issue.identifier,
        sessionId,
      });

      // Turn loop
      const maxTurns = config.agent.max_turns;
      let turnNumber = 0;

      while (turnNumber < maxTurns) {
        turnNumber++;

        // Build prompt
        const prompt = turnNumber === 1
          ? renderTemplate(workflow.promptTemplate, issue, attempt)
          : buildContinuationGuidance(issue, attempt);

        // Run one turn
        const turnResult = await agent.runTurn(session, prompt, (event) => {
          this.onAgentEvent(issue.id, event);
        });

        if (turnResult.status !== "completed") {
          // Turn failed
          this.deps.executionLog?.append({
            event: "turn_failed",
            timestamp: new Date().toISOString(),
            issueId: issue.id,
            identifier: issue.identifier,
            turn: turnNumber,
            error: turnResult.error ?? "unknown",
          });
          await runHookBestEffort("after_run", hooks, workspace.path);
          await agent.stopSession(session);
          this.onWorkerExit(issue.id, "failed", turnResult.error);
          return;
        }

        // Update turn count in running entry
        const e = this.state.running.get(issue.id);
        if (e) e.turnCount = turnNumber;

        this.deps.executionLog?.append({
          event: "turn_completed",
          timestamp: new Date().toISOString(),
          issueId: issue.id,
          identifier: issue.identifier,
          turn: turnNumber,
          inputTokens: e?.tokenUsage.inputTokens ?? 0,
          outputTokens: e?.tokenUsage.outputTokens ?? 0,
        });

        // Refresh issue state from tracker
        let refreshedIssues: Issue[];
        try {
          refreshedIssues = await this.deps.tracker.fetchIssueStatesByIds([issue.id]);
        } catch {
          await runHookBestEffort("after_run", hooks, workspace.path);
          await agent.stopSession(session);
          this.onWorkerExit(issue.id, "failed", "issue state refresh error");
          return;
        }

        if (refreshedIssues.length > 0) {
          issue = refreshedIssues[0]!;
          if (entry) entry.issue = issue;
        }

        // Check if still active
        if (!isActiveState(issue.state, config.tracker.active_states)) {
          logger.info({ issueId: issue.id, state: issue.state }, "Issue no longer active, stopping worker");
          break;
        }
      }

      // Worker finished normally
      await runHookBestEffort("after_run", hooks, workspace.path);
      if (session) await agent.stopSession(session);
      this.onWorkerExit(issue.id, "normal");
    } catch (err) {
      logger.error({ issueId: issue.id, error: String(err) }, "Worker error");
      if (session) await agent.stopSession(session).catch(() => {});
      this.onWorkerExit(issue.id, "failed", String(err));
    }
  }

  // T29: Reconcile
  private reconcileStalled(): void {
    const stallTimeoutMs = this.deps.config.agent.stall_timeout_ms;
    if (stallTimeoutMs <= 0) return; // disabled

    const now = Date.now();
    for (const [issueId, entry] of this.state.running) {
      const lastActivity = entry.lastAgentTimestamp ?? entry.startedAt;
      const elapsed = now - lastActivity.getTime();
      if (elapsed > stallTimeoutMs) {
        logger.warn({ issueId, elapsed, stallTimeoutMs }, "Stall detected, terminating worker");
        this.deps.executionLog?.append({
          event: "stall_detected",
          timestamp: new Date().toISOString(),
          issueId,
          identifier: entry.identifier,
          elapsed,
          timeout: stallTimeoutMs,
        });
        this.deps.executionLog?.append({
          event: "worker_exit",
          timestamp: new Date().toISOString(),
          issueId,
          identifier: entry.identifier,
          reason: "stall",
          turns: entry.turnCount,
          totalTokens: entry.tokenUsage.totalTokens,
        });
        // In Claude Code model, each turn is a separate process,
        // so stall detection is mainly a safety net.
        // The running entry will be cleaned up when the worker eventually exits.
        this.state.running.delete(issueId);
        addRuntimeSeconds(this.state, entry);
        this.finalizeWorkerTokens(entry);
        this.state.claimed.delete(issueId);
        this.deps.executionLog?.append({
          event: "retry_scheduled",
          timestamp: new Date().toISOString(),
          issueId,
          identifier: entry.identifier,
          attempt: entry.retryAttempt + 1,
          backoffMs: this.deps.config.agent.max_retry_backoff_ms,
          reason: "stall detected",
        });
        scheduleRetry(
          this.state,
          issueId,
          entry.identifier,
          entry.retryAttempt + 1,
          "stall detected",
          this.deps.config.agent.max_retry_backoff_ms,
          (id) => this.onRetryTimer(id),
        );
      }
    }
  }

  private async reconcileTrackerStates(): Promise<void> {
    const runningIds = [...this.state.running.keys()];
    if (runningIds.length === 0) return;

    let refreshed: Issue[];
    try {
      refreshed = await this.deps.tracker.fetchIssueStatesByIds(runningIds);
    } catch (err) {
      logger.debug({ error: String(err) }, "Reconciliation state refresh failed, keeping workers");
      return;
    }

    const activeStates = this.deps.config.tracker.active_states;
    const terminalStates = this.deps.config.tracker.terminal_states;

    for (const issue of refreshed) {
      const entry = this.state.running.get(issue.id);
      if (!entry) continue;

      if (isTerminalState(issue.state, terminalStates)) {
        logger.info({ issueId: issue.id, state: issue.state }, "Issue is terminal, terminating worker");
        this.deps.executionLog?.append({
          event: "worker_exit",
          timestamp: new Date().toISOString(),
          issueId: issue.id,
          identifier: entry.identifier,
          reason: "normal",
          turns: entry.turnCount,
          totalTokens: entry.tokenUsage.totalTokens,
        });
        this.state.running.delete(issue.id);
        addRuntimeSeconds(this.state, entry);
        this.finalizeWorkerTokens(entry);
        this.state.claimed.delete(issue.id);
        this.deps.workspaceManager.cleanupWorkspace(issue.identifier).catch(() => {});
      } else if (isActiveState(issue.state, activeStates)) {
        // Update in-memory issue snapshot
        entry.issue = issue;
      } else {
        // Non-active, non-terminal: stop without cleanup
        logger.info({ issueId: issue.id, state: issue.state }, "Issue is non-active, stopping worker");
        this.deps.executionLog?.append({
          event: "worker_exit",
          timestamp: new Date().toISOString(),
          issueId: issue.id,
          identifier: entry.identifier,
          reason: "external_cancel",
          turns: entry.turnCount,
          totalTokens: entry.tokenUsage.totalTokens,
        });
        this.state.running.delete(issue.id);
        addRuntimeSeconds(this.state, entry);
        this.finalizeWorkerTokens(entry);
        this.state.claimed.delete(issue.id);
      }
    }
  }

  private finalizeWorkerTokens(entry: RunningEntry): void {
    addTokenUsage(this.state, entry);

    if (this.deps.tokenLog) {
      try {
        this.deps.tokenLog.append({
          identifier: entry.identifier,
          issueId: entry.issue.id,
          inputTokens: entry.tokenUsage.inputTokens,
          outputTokens: entry.tokenUsage.outputTokens,
          totalTokens: entry.tokenUsage.totalTokens,
          turns: entry.turnCount,
          retryAttempt: entry.retryAttempt,
          completedAt: new Date().toISOString(),
        });
      } catch (err) {
        logger.warn({ identifier: entry.identifier, error: String(err) }, "Token log write failed");
      }
    }

    this.deps.tracker.updateIssueTokens(entry.issue.id, entry.tokenUsage).catch((err) => {
      logger.warn({ issueId: entry.issue.id, error: String(err) }, "Token tracker update failed");
    });
  }

  // T31: Worker exit handler
  private async onWorkerExit(issueId: string, reason: "normal" | "failed", error?: string | null): Promise<void> {
    const entry = this.state.running.get(issueId);
    if (!entry) return;

    this.deps.executionLog?.append({
      event: "worker_exit",
      timestamp: new Date().toISOString(),
      issueId,
      identifier: entry.identifier,
      reason,
      turns: entry.turnCount,
      totalTokens: entry.tokenUsage.totalTokens,
    });

    this.state.running.delete(issueId);
    this.state.claimed.delete(issueId);
    addRuntimeSeconds(this.state, entry);
    this.finalizeWorkerTokens(entry);

    if (reason === "normal") {
      // Mark issue as completed in tracker
      const terminalState = this.deps.config.tracker.terminal_states[0] ?? "已完成";
      try {
        await this.deps.tracker.updateIssueState(issueId, terminalState);
        logger.info({ issueId, state: terminalState }, "Issue marked as completed in tracker");
        this.deps.executionLog?.append({
          event: "tracker_state_updated",
          timestamp: new Date().toISOString(),
          issueId,
          identifier: entry.identifier,
          fromState: entry.issue.state,
          toState: terminalState,
        });
      } catch (err) {
        logger.warn({ issueId, error: String(err) }, "Failed to update issue state in tracker");
      }
      this.state.completed.add(issueId);
    } else {
      // Reset to active state so retry can re-dispatch
      try {
        await this.deps.tracker.updateIssueState(issueId, this.deps.config.agent.active_reset_state);
        logger.info({ issueId }, "Issue reset to active state for retry");
        this.deps.executionLog?.append({
          event: "tracker_state_updated",
          timestamp: new Date().toISOString(),
          issueId,
          identifier: entry.identifier,
          fromState: entry.issue.state,
          toState: this.deps.config.agent.active_reset_state,
        });
      } catch (err) {
        logger.warn({ issueId, error: String(err) }, "Failed to reset issue state for retry");
      }
      this.deps.executionLog?.append({
        event: "retry_scheduled",
        timestamp: new Date().toISOString(),
        issueId,
        identifier: entry.identifier,
        attempt: entry.retryAttempt + 1,
        backoffMs: this.deps.config.agent.max_retry_backoff_ms,
        reason: error ?? "worker failed",
      });
      scheduleRetry(
        this.state,
        issueId,
        entry.identifier,
        entry.retryAttempt + 1,
        error ?? "worker failed",
        this.deps.config.agent.max_retry_backoff_ms,
        (id) => this.onRetryTimer(id),
      );
    }
  }

  // Retry timer callback
  private async onRetryTimer(issueId: string): Promise<void> {
    const retry = this.state.retryAttempts.get(issueId);
    if (!retry) return;

    this.state.retryAttempts.delete(issueId);

    // Re-fetch candidates
    let candidates: Issue[];
    try {
      candidates = await this.deps.tracker.fetchCandidateIssues();
    } catch {
      this.deps.executionLog?.append({
        event: "retry_scheduled",
        timestamp: new Date().toISOString(),
        issueId,
        identifier: retry.identifier,
        attempt: retry.attempt + 1,
        backoffMs: this.deps.config.agent.max_retry_backoff_ms,
        reason: "retry poll failed",
      });
      scheduleRetry(
        this.state,
        issueId,
        retry.identifier,
        retry.attempt + 1,
        "retry poll failed",
        this.deps.config.agent.max_retry_backoff_ms,
        (id) => this.onRetryTimer(id),
      );
      return;
    }

    const issue = candidates.find((c) => c.id === issueId);
    if (!issue) {
      // Issue no longer in candidates, release claim
      this.state.claimed.delete(issueId);
      logger.info({ issueId }, "Issue no longer candidate, claim released");
      return;
    }

    if (availableSlots(this.state, this.state.maxConcurrentAgents) <= 0) {
      this.deps.executionLog?.append({
        event: "retry_scheduled",
        timestamp: new Date().toISOString(),
        issueId,
        identifier: retry.identifier,
        attempt: retry.attempt + 1,
        backoffMs: this.deps.config.agent.max_retry_backoff_ms,
        reason: "no available orchestrator slots",
      });
      scheduleRetry(
        this.state,
        issueId,
        retry.identifier,
        retry.attempt + 1,
        "no available orchestrator slots",
        this.deps.config.agent.max_retry_backoff_ms,
        (id) => this.onRetryTimer(id),
      );
      return;
    }

    this.dispatchIssue(issue, retry.attempt);
  }

  // Agent event callback
  private onAgentEvent(issueId: string, event: AgentEvent): void {
    const entry = this.state.running.get(issueId);
    if (!entry) return;

    entry.lastAgentEvent = event.event;
    entry.lastAgentTimestamp = new Date(event.timestamp);
    entry.lastAgentMessage = event.message ?? null;

    if (event.usage) {
      // Track deltas to avoid double-counting
      const delta = {
        inputTokens: event.usage.inputTokens - entry.lastReportedTokenUsage.inputTokens,
        outputTokens: event.usage.outputTokens - entry.lastReportedTokenUsage.outputTokens,
        totalTokens: event.usage.totalTokens - entry.lastReportedTokenUsage.totalTokens,
      };
      entry.tokenUsage.inputTokens += Math.max(0, delta.inputTokens);
      entry.tokenUsage.outputTokens += Math.max(0, delta.outputTokens);
      entry.tokenUsage.totalTokens += Math.max(0, delta.totalTokens);
      entry.lastReportedTokenUsage = { ...event.usage };
    }

    if (event.rateLimits) {
      this.state.rateLimits = event.rateLimits;
    }
  }

  // T34: Startup cleanup
  private async startupCleanup(): Promise<void> {
    try {
      const terminalIssues = await this.deps.tracker.fetchIssuesByStates(
        this.deps.config.tracker.terminal_states,
      );
      const identifiers = terminalIssues.map((i) => i.identifier);
      await this.deps.workspaceManager.cleanupTerminalWorkspaces(identifiers);
      logger.info({ count: identifiers.length }, "Startup terminal workspace cleanup done");
    } catch (err) {
      logger.warn({ error: String(err) }, "Startup cleanup failed, continuing");
    }
  }
}
