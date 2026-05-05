import type { Issue, RunningEntry, ServiceConfig } from "../model/index.ts";
import type { TrackerAdapter } from "../adapters/tracker/types.ts";
import type { WorkspaceManager } from "../workspace/manager.ts";
import type { OrchestratorState } from "./state.ts";
import { isActiveState, isTerminalState, addRuntimeSeconds, addTokenUsage } from "./state.ts";
import { scheduleRetry } from "./retry.ts";
import { logger } from "../logging/logger.ts";

export interface ReconcilerDeps {
  state: OrchestratorState;
  config: ServiceConfig;
  tracker: TrackerAdapter;
  workspaceManager: WorkspaceManager;
}

export class Reconciler {
  constructor(
    private readonly deps: ReconcilerDeps,
    private readonly onRetryTimer: (issueId: string) => void,
  ) {}

  reconcileStalled(): void {
    const stallTimeoutMs = this.deps.config.agent.stall_timeout_ms;
    if (stallTimeoutMs <= 0) return; // disabled

    const now = Date.now();
    for (const [issueId, entry] of this.deps.state.running) {
      const lastActivity = entry.lastAgentTimestamp ?? entry.startedAt;
      const elapsed = now - lastActivity.getTime();
      if (elapsed > stallTimeoutMs) {
        logger.warn(
          { issueId, elapsed, stallTimeoutMs },
          "Stall detected, terminating worker",
        );
        logger.info(
          { event: "stall_detected", issueId, identifier: entry.identifier, elapsed, timeout: stallTimeoutMs },
          "Stall detected",
        );
        logger.info(
          { event: "worker_exit", issueId, identifier: entry.identifier, reason: "stall", turns: entry.turnCount, totalTokens: entry.tokenUsage.totalTokens },
          "Worker exiting due to stall",
        );
        this.deps.state.running.delete(issueId);
        addRuntimeSeconds(this.deps.state, entry);
        this.finalizeWorkerTokens(entry);
        this.deps.state.claimed.delete(issueId);
        logger.info(
          { event: "retry_scheduled", issueId, identifier: entry.identifier, attempt: entry.retryAttempt + 1, backoffMs: this.deps.config.agent.max_retry_backoff_ms, reason: "stall detected" },
          "Retry scheduled after stall",
        );
        scheduleRetry(
          this.deps.state,
          issueId,
          entry.identifier,
          entry.retryAttempt + 1,
          "stall detected",
          this.deps.config.agent.max_retry_backoff_ms,
          this.onRetryTimer,
        );
      }
    }
  }

  async reconcileTrackerStates(): Promise<void> {
    const runningIds = [...this.deps.state.running.keys()];
    if (runningIds.length === 0) return;

    let refreshed: Issue[];
    try {
      refreshed = await this.deps.tracker.fetchIssueStatesByIds(runningIds);
    } catch (err) {
      logger.debug(
        { error: String(err) },
        "Reconciliation state refresh failed, keeping workers",
      );
      return;
    }

    const activeStates = this.deps.config.tracker.active_states;
    const terminalStates = this.deps.config.tracker.terminal_states;

    for (const issue of refreshed) {
      const entry = this.deps.state.running.get(issue.id);
      if (!entry) continue;

      if (isTerminalState(issue.state, terminalStates)) {
        logger.info(
          { issueId: issue.id, state: issue.state },
          "Issue is terminal, terminating worker",
        );
        logger.info(
          { event: "worker_exit", issueId: issue.id, identifier: entry.identifier, reason: "normal", turns: entry.turnCount, totalTokens: entry.tokenUsage.totalTokens },
          "Worker exiting normally",
        );
        this.deps.state.running.delete(issue.id);
        addRuntimeSeconds(this.deps.state, entry);
        this.finalizeWorkerTokens(entry);
        this.deps.state.claimed.delete(issue.id);
        this.deps.workspaceManager
          .cleanupWorkspace(issue.identifier)
          .catch(() => {});
      } else if (isActiveState(issue.state, activeStates)) {
        // Update in-memory issue snapshot
        entry.issue = issue;
      } else {
        // Non-active, non-terminal: stop without cleanup
        logger.info(
          { issueId: issue.id, state: issue.state },
          "Issue is non-active, stopping worker",
        );
        logger.info(
          { event: "worker_exit", issueId: issue.id, identifier: entry.identifier, reason: "external_cancel", turns: entry.turnCount, totalTokens: entry.tokenUsage.totalTokens },
          "Worker exiting due to external cancel",
        );
        this.deps.state.running.delete(issue.id);
        addRuntimeSeconds(this.deps.state, entry);
        this.finalizeWorkerTokens(entry);
        this.deps.state.claimed.delete(issue.id);
      }
    }
  }

  async startupCleanup(): Promise<void> {
    try {
      const terminalIssues = await this.deps.tracker.fetchIssuesByStates(
        this.deps.config.tracker.terminal_states,
      );
      const identifiers = terminalIssues.map((i) => i.identifier);
      await this.deps.workspaceManager.cleanupTerminalWorkspaces(identifiers);
      logger.info(
        { count: identifiers.length },
        "Startup terminal workspace cleanup done",
      );
    } catch (err) {
      logger.warn({ error: String(err) }, "Startup cleanup failed, continuing");
    }
  }

  finalizeWorkerTokens(entry: RunningEntry): void {
    addTokenUsage(this.deps.state, entry);

    logger.info(
      {
        identifier: entry.identifier,
        issueId: entry.issue.id,
        inputTokens: entry.tokenUsage.inputTokens,
        outputTokens: entry.tokenUsage.outputTokens,
        totalTokens: entry.tokenUsage.totalTokens,
        turns: entry.turnCount,
        retryAttempt: entry.retryAttempt,
      },
      "Worker token usage finalized",
    );

    this.deps.tracker
      .updateIssueTokens(entry.issue.id, entry.tokenUsage)
      .catch((err) => {
        logger.warn(
          { issueId: entry.issue.id, error: String(err) },
          "Token tracker update failed",
        );
      });
  }
}
