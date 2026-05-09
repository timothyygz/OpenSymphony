import type {
  ServiceConfig,
  Issue,
  WorkflowDefinition,
} from "../model/index.ts";
import type { TrackerAdapter } from "../adapters/tracker/types.ts";
import type { WorkspaceManager } from "../workspace/manager.ts";
import {
  createInitialState,
} from "./state.ts";
import type { OrchestratorState } from "./state.ts";
import { sortForDispatch, canDispatch, availableSlots } from "./dispatch.ts";
import { scheduleRetry } from "./retry.ts";

import { validateDispatchConfig } from "../workflow/config.ts";
import { logger } from "../logging/logger.ts";
import type { ExecutionLog } from "../logging/execution-log.ts";
import type { TokenStore } from "../metrics/token-store.ts";
import { EventProcessor } from "./event-processor.ts";
import { Reconciler } from "./reconciler.ts";
import { WorkerRunner } from "./worker-runner.ts";

export interface OrchestratorDeps {
  config: ServiceConfig;
  workflow: WorkflowDefinition;
  tracker: TrackerAdapter;
  agent: import("../adapters/agent/types.ts").AgentAdapter;
  workspaceManager: WorkspaceManager;
  tokenStore?: TokenStore;
  executionLog?: ExecutionLog;
}

export class Orchestrator {
  private state: OrchestratorState;
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private running = true;
  /** Active worker promises, keyed by issueId */
  private activeWorkers = new Map<string, Promise<void>>();
  /** Graceful shutdown timeout (ms) */
  private static readonly SHUTDOWN_TIMEOUT_MS = 30_000;

  private readonly reconciler: Reconciler;
  private readonly workerRunner: WorkerRunner;
  private readonly eventProcessor: EventProcessor;

  constructor(private readonly deps: OrchestratorDeps) {
    this.state = createInitialState();
    this.applyConfig(deps.config);

    // Wire sub-modules
    this.eventProcessor = new EventProcessor({
      state: this.state,
      tracker: deps.tracker,
    });

    this.reconciler = new Reconciler(
      {
        state: this.state,
        config: deps.config,
        tracker: deps.tracker,
        workspaceManager: deps.workspaceManager,
        tokenStore: deps.tokenStore,
      },
      (issueId) => this.onRetryTimer(issueId),
    );

    this.workerRunner = new WorkerRunner({
      state: this.state,
      config: deps.config,
      workflow: deps.workflow,
      tracker: deps.tracker,
      agent: deps.agent,
      workspaceManager: deps.workspaceManager,
      eventProcessor: this.eventProcessor,
    });
  }

  async start(): Promise<void> {
    logger.info("Orchestrator starting");

    // Startup terminal workspace cleanup
    await this.reconciler.startupCleanup();

    // Immediate first tick
    await this.tick();

    // Schedule subsequent ticks
    this.scheduleTick();
  }

  async stop(): Promise<void> {
    logger.info("Orchestrator stopping...");

    // 1. Stop accepting new work
    this.running = false;

    // 2. Cancel tick timer
    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }

    // 3. Cancel all retry timers
    for (const [issueId, retry] of this.state.retryAttempts) {
      if (retry.timerHandle) {
        clearTimeout(retry.timerHandle);
      }
      this.state.retryAttempts.delete(issueId);
    }

    // 4. Wait for active workers with a timeout
    const workers = [...this.activeWorkers.values()];
    if (workers.length > 0) {
      logger.info(
        { activeWorkers: workers.length },
        "Waiting for active workers to finish",
      );

      const timeout = new Promise<void>((resolve) =>
        setTimeout(() => {
          logger.warn(
            { activeWorkers: this.activeWorkers.size },
            "Shutdown timeout reached, forcing exit",
          );
          resolve();
        }, Orchestrator.SHUTDOWN_TIMEOUT_MS),
      );

      await Promise.race([Promise.allSettled(workers), timeout]);
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

  /**
   * Schedule a retry or mark the issue as permanently failed when
   * max_retry_attempts is exceeded.
   * Returns true if a retry was scheduled, false if permanently failed.
   */
  private retryOrFail(
    issueId: string,
    identifier: string,
    nextAttempt: number,
    error: string | null,
  ): boolean {
    const maxAttempts = this.deps.config.agent.max_retry_attempts;

    if (nextAttempt > maxAttempts) {
      logger.warn(
        { issueId, identifier, nextAttempt, maxAttempts },
        "Max retry attempts exceeded, marking as permanently failed",
      );
      logger.info(
        { event: "permanent_failure", issueId, identifier, attempt: nextAttempt, maxAttempts, error: error ?? undefined },
        "Permanent failure recorded",
      );
      this.state.claimed.delete(issueId);
      this.deps.tracker
        .updateIssueState(issueId, this.deps.config.agent.permanent_failure_state)
        .catch((err) => {
          logger.warn(
            { issueId, error: String(err) },
            "Failed to mark issue as permanently failed",
          );
        });
      return false;
    }

    logger.info(
      { event: "retry_scheduled", issueId, identifier, attempt: nextAttempt, backoffMs: this.deps.config.agent.max_retry_backoff_ms, reason: error ?? "retry" },
      "Retry scheduled",
    );
    scheduleRetry(
      this.state,
      issueId,
      identifier,
      nextAttempt,
      error,
      this.deps.config.agent.max_retry_backoff_ms,
      (id) => this.onRetryTimer(id),
    );
    return true;
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
      this.reconciler.reconcileStalled();
      await this.reconciler.reconcileTrackerStates();

      // Step 2: Dispatch preflight validation
      const validationError = validateDispatchConfig(this.deps.config);
      if (validationError) {
        logger.error(
          { error: validationError },
          "Dispatch validation failed, skipping dispatch",
        );
        return;
      }

      // Step 3: Fetch candidate issues
      let issues: Issue[];
      try {
        issues = await this.deps.tracker.fetchCandidateIssues();
      } catch (err) {
        logger.error(
          { error: String(err) },
          "Failed to fetch candidate issues",
        );
        return;
      }

      // Step 4: Sort for dispatch
      const sorted = sortForDispatch(issues);

      // Step 5: Dispatch eligible issues
      const perStateMap = new Map(
        Object.entries(this.deps.config.agent.max_concurrent_agents_by_state),
      );

      for (const issue of sorted) {
        if (availableSlots(this.state, this.state.maxConcurrentAgents) <= 0)
          break;

        if (
          canDispatch(
            issue,
            this.state,
            this.state.maxConcurrentAgents,
            perStateMap,
            this.deps.config.tracker.active_states,
          )
        ) {
          const workerPromise = this.workerRunner.dispatchIssue(issue, null, (id, reason, err) =>
            this.onWorkerExit(id, reason, err),
          )
            .finally(() => {
              this.activeWorkers.delete(issue.id);
            });
          this.activeWorkers.set(issue.id, workerPromise);
        }
      }
    } catch (err) {
      logger.error({ error: String(err) }, "Tick error");
    }
  }

  // T31: Worker exit handler
  private async onWorkerExit(
    issueId: string,
    reason: "normal" | "failed",
    error?: string | null,
  ): Promise<void> {
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
    this.reconciler.finalizeWorkerTokens(entry);

    if (reason === "normal") {
      logger.info(
        { issueId },
        "Worker exited normally, agent should have updated tracker",
      );
      this.state.completed.add(issueId);
      this.state.recentCompleted.push({
        identifier: entry.identifier,
        title: entry.issue.title ?? "unknown",
        totalTokens: entry.tokenUsage.totalTokens,
        turns: entry.turnCount,
        runtimeSeconds: (Date.now() - entry.startedAt.getTime()) / 1000,
        completedAt: new Date(),
      });
      while (this.state.recentCompleted.length > 10) {
        this.state.recentCompleted.shift();
      }
    } else {
      // Reset to active state so retry can re-dispatch
      try {
        await this.deps.tracker.updateIssueState(
          issueId,
          this.deps.config.agent.active_reset_state,
        );
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
        logger.warn(
          { issueId, error: String(err) },
          "Failed to reset issue state for retry",
        );
      }
      this.retryOrFail(
        issueId,
        entry.identifier,
        entry.retryAttempt + 1,
        error ?? "worker failed",
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
      this.retryOrFail(
        issueId,
        retry.identifier,
        retry.attempt + 1,
        "retry poll failed",
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
      this.retryOrFail(
        issueId,
        retry.identifier,
        retry.attempt + 1,
        "no available orchestrator slots",
      );
      return;
    }

    const workerPromise = this.workerRunner.dispatchIssue(issue, retry.attempt, (id, reason, err) =>
      this.onWorkerExit(id, reason, err),
    )
      .finally(() => {
        this.activeWorkers.delete(issue.id);
      });
    this.activeWorkers.set(issue.id, workerPromise);
  }
}
