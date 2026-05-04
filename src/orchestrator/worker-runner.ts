import type {
  Issue,
  RunningEntry,
  ServiceConfig,
  WorkflowDefinition,
} from "../model/index.ts";
import type { TrackerAdapter } from "../adapters/tracker/types.ts";
import type {
  AgentAdapter,
  AgentSession,
} from "../adapters/agent/types.ts";
import type { WorkspaceManager } from "../workspace/manager.ts";
import { hashSources } from "../workspace/manager.ts";
import {
  renderTemplate,
  buildContinuationGuidance,
} from "../workflow/prompt.ts";
import { runHookIfConfigured, runHookBestEffort } from "../workspace/hooks.ts";
import { isActiveState } from "./state.ts";
import type { OrchestratorState } from "./state.ts";
import { cancelRetry } from "./retry.ts";
import { createTrackerMcpServer } from "../adapters/agent/claude-code/tracker-tools.ts";
import { FeishuBitableAdapter } from "../adapters/tracker/feishu-bitable/adapter.ts";
import { logger } from "../logging/logger.ts";
import type { ExecutionLog } from "../logging/execution-log.ts";
import { TurnLog, writeMetaJson, updateMetaJson } from "../logging/turn-log.ts";
import type { EventProcessor } from "./event-processor.ts";

export type WorkerExitCallback = (
  issueId: string,
  reason: "normal" | "failed",
  error?: string | null,
) => Promise<void>;

export interface WorkerRunnerDeps {
  state: OrchestratorState;
  config: ServiceConfig;
  workflow: WorkflowDefinition;
  tracker: TrackerAdapter;
  agent: AgentAdapter;
  workspaceManager: WorkspaceManager;
  executionLog?: ExecutionLog;
  eventProcessor: EventProcessor;
}

export class WorkerRunner {
  constructor(private readonly deps: WorkerRunnerDeps) {}

  get state(): OrchestratorState {
    return this.deps.state;
  }

  get config(): ServiceConfig {
    return this.deps.config;
  }

  dispatchIssue(
    issue: Issue,
    attempt: number | null,
    onWorkerExit: WorkerExitCallback,
  ): void {
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
      lastReportedTokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
      retryAttempt: attempt ?? 0,
      startedAt: new Date(),
      turnCount: 0,
    };

    this.deps.state.running.set(issue.id, entry);
    this.deps.state.claimed.add(issue.id);
    cancelRetry(this.deps.state, issue.id);

    // Distributed lock: mark issue as in-progress so other instances skip it
    const fromState = issue.state;
    this.deps.tracker
      .updateIssueState(issue.id, this.deps.config.agent.in_progress_state)
      .catch((err) => {
        logger.warn(
          { issueId: issue.id, error: String(err) },
          "Failed to mark issue as in-progress",
        );
      });
    this.deps.executionLog?.append({
      event: "tracker_state_updated",
      timestamp: new Date().toISOString(),
      issueId: issue.id,
      identifier: issue.identifier,
      fromState,
      toState: this.deps.config.agent.in_progress_state,
    });

    logger.info(
      { issueId: issue.id, identifier: issue.identifier, attempt },
      "Dispatching issue",
    );

    this.deps.executionLog?.append({
      event: "dispatch",
      timestamp: new Date().toISOString(),
      issueId: issue.id,
      identifier: issue.identifier,
      attempt: attempt ?? 0,
    });

    // Run worker in background
    this.runWorker(issue, attempt, sessionId, onWorkerExit).catch((err) => {
      logger.error(
        { issueId: issue.id, error: String(err) },
        "Worker spawn failed",
      );
      this.deps.executionLog?.append({
        event: "worker_spawn_failed",
        timestamp: new Date().toISOString(),
        issueId: issue.id,
        identifier: issue.identifier,
        error: String(err),
      });
      this.deps.state.running.delete(issue.id);
      this.deps.state.claimed.delete(issue.id);
      // Reset state so retry can re-dispatch
      this.deps.tracker
        .updateIssueState(issue.id, this.deps.config.agent.active_reset_state)
        .catch(() => {});
      this.deps.executionLog?.append({
        event: "retry_scheduled",
        timestamp: new Date().toISOString(),
        issueId: issue.id,
        identifier: issue.identifier,
        attempt: (attempt ?? 0) + 1,
        backoffMs: this.deps.config.agent.max_retry_backoff_ms,
        reason: String(err),
      });
    });
  }

  async runWorker(
    issue: Issue,
    attempt: number | null,
    sessionId: string,
    onWorkerExit: WorkerExitCallback,
  ): Promise<void> {
    const { config, workflow, agent, workspaceManager } = this.deps;
    const hooks = config.hooks;
    let session: AgentSession | null = null;

    try {
      // Create/reuse workspace
      const workspace = await workspaceManager.createForIssue(issue.identifier);

      // before_run hook
      await runHookIfConfigured("before_run", hooks, workspace.path);

      // Create tracker MCP server for agent (if tracker is FeishuBitable)
      let mcpServers:
        | Record<
            string,
            import("@anthropic-ai/claude-agent-sdk").McpServerConfig
          >
        | undefined;
      if (this.deps.tracker instanceof FeishuBitableAdapter) {
        const trackerMcpServer = createTrackerMcpServer(
          this.deps.tracker.api,
          issue.id,
        );
        mcpServers = { tracker: trackerMcpServer };
      }

      // Start agent session
      session = await agent.startSession({
        workspacePath: workspace.path,
        issue,
        sessionId,
        config: config as unknown as Record<string, unknown>,
        mcpServers,
      });

      // Update running entry with session info
      const entry = this.deps.state.running.get(issue.id);

      // Initialize turn log and meta.json
      let turnLog: TurnLog | null = null;
      try {
        turnLog = new TurnLog(workspace.path);
        const sources = config.workspace.sources ?? [];
        writeMetaJson(workspace.path, {
          issueId: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          workspacePath: workspace.path,
          sessionId: null,
          startedAt: new Date().toISOString(),
          totalTurns: 0,
          totalTokens: 0,
          sources: sources.length > 0 ? sources : undefined,
          sourcesHash: sources.length > 0 ? hashSources(sources) : undefined,
        });
      } catch (err) {
        logger.warn(
          { issueId: issue.id, error: String(err) },
          "Failed to initialize turn log",
        );
      }

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
      const toolCallsByTurn = new Map<number, string[]>();

      while (turnNumber < maxTurns) {
        turnNumber++;

        // Build prompt
        const trackerGuidance = mcpServers
          ? "\n\nYou have a 'tracker_tool' tool to interact with the Feishu Bitable tracker. " +
            "Use 'tracker_tool' action='update' to update fields (state, progress, result summary, etc.). " +
            "When the task is complete, update the result summary and state to mark it done. " +
            "Use 'tracker_tool' action='get' to read the current record if needed."
          : "";
        const prompt =
          turnNumber === 1
            ? renderTemplate(workflow.promptTemplate, issue, attempt) +
              trackerGuidance
            : buildContinuationGuidance(issue, attempt) + trackerGuidance;

        // Log user prompt
        turnLog?.logUserPrompt(turnNumber, prompt);

        // Run one turn
        const turnLogRef = turnLog;
        const toolCallsRef = toolCallsByTurn;
        const turnResult = await agent.runTurn(session, prompt, (event) => {
          this.deps.eventProcessor.onAgentEvent(
            issue.id,
            event,
            turnNumber,
            turnLogRef,
            toolCallsRef,
            workspace.path,
          );
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
          await onWorkerExit(issue.id, "failed", turnResult.error);
          return;
        }

        // Update turn count in running entry
        const e = this.deps.state.running.get(issue.id);
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

        // Update meta.json with turn progress
        if (e) {
          updateMetaJson(workspace.path, {
            totalTurns: turnNumber,
            totalTokens: e.tokenUsage.totalTokens,
            lastTurnAt: new Date().toISOString(),
          });
        }

        // Refresh issue state from tracker
        let refreshedIssues: Issue[];
        try {
          refreshedIssues = await this.deps.tracker.fetchIssueStatesByIds([
            issue.id,
          ]);
        } catch {
          await runHookBestEffort("after_run", hooks, workspace.path);
          await agent.stopSession(session);
          await onWorkerExit(issue.id, "failed", "issue state refresh error");
          return;
        }

        if (refreshedIssues.length > 0) {
          issue = refreshedIssues[0]!;
          if (entry) entry.issue = issue;
        }

        // Check if still active
        if (!isActiveState(issue.state, config.tracker.active_states)) {
          logger.info(
            { issueId: issue.id, state: issue.state },
            "Issue no longer active, stopping worker",
          );
          break;
        }
      }

      // Worker finished normally
      await runHookBestEffort("after_run", hooks, workspace.path);
      if (session) await agent.stopSession(session);
      await onWorkerExit(issue.id, "normal");
    } catch (err) {
      logger.error({ issueId: issue.id, error: String(err) }, "Worker error");
      if (session) await agent.stopSession(session).catch(() => {});
      await onWorkerExit(issue.id, "failed", String(err));
    }
  }
}
