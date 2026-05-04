import type { AgentEvent } from "../adapters/agent/types.ts";
import type { RunningEntry } from "../model/index.ts";
import type { OrchestratorState } from "./state.ts";
import { updateMetaJson } from "../logging/turn-log.ts";
import type { TurnLog } from "../logging/turn-log.ts";
import type { TrackerAdapter } from "../adapters/tracker/types.ts";
import { logger } from "../logging/logger.ts";

export interface EventProcessorDeps {
  state: OrchestratorState;
  tracker: TrackerAdapter;
}

export class EventProcessor {
  constructor(private readonly deps: EventProcessorDeps) {}

  onAgentEvent(
    issueId: string,
    event: AgentEvent,
    turn: number,
    turnLog: TurnLog | null,
    toolCallsByTurn: Map<number, string[]> | null,
    workspacePath: string,
  ): void {
    const entry = this.deps.state.running.get(issueId);
    if (!entry) return;

    entry.lastAgentEvent = event.event;
    entry.lastAgentTimestamp = new Date(event.timestamp);
    entry.lastAgentMessage = event.message ?? null;

    // Capture real session ID from stream-json output
    if (event.sessionId && !entry.sessionId) {
      entry.sessionId = event.sessionId;
      updateMetaJson(workspacePath, { sessionId: event.sessionId });

      // Record join command in tracker so user can resume the session
      this.deps.tracker
        .updateIssueJoinCommand?.(
          issueId,
          `cd "${workspacePath}" && claude --resume ${event.sessionId}`,
        )
        .catch((err) => {
          logger.warn(
            { issueId, error: String(err) },
            "Failed to update join command in tracker",
          );
        });
    }

    // Log agent events to turn log
    if (turnLog) {
      this.logToTurnLog(turnLog, toolCallsByTurn, turn, event);
    }

    if (event.usage) {
      this.trackTokenDeltas(entry, event.usage);
    }

    if (event.rateLimits) {
      this.deps.state.rateLimits = event.rateLimits;
    }
  }

  private logToTurnLog(
    turnLog: TurnLog,
    toolCallsByTurn: Map<number, string[]> | null,
    turn: number,
    event: AgentEvent,
  ): void {
    if (
      event.message &&
      (event.event === "assistant" || event.event === "message")
    ) {
      turnLog.logAssistantMessage(turn, event.message);
    }
    if (event.toolName) {
      turnLog.logToolUse(turn, event.toolName, event.toolInput);
      toolCallsByTurn?.get(turn)?.push(event.toolName) ??
        toolCallsByTurn?.set(turn, [event.toolName]);
    }
    if (event.event === "tool_result" && event.rawEvent) {
      const output =
        typeof event.rawEvent.result === "string"
          ? event.rawEvent.result
          : (event.message ?? "");
      turnLog.logToolResult(turn, event.toolName ?? "unknown", output);
    }
  }

  private trackTokenDeltas(
    entry: RunningEntry,
    usage: { inputTokens: number; outputTokens: number; totalTokens: number },
  ): void {
    const delta = {
      inputTokens:
        usage.inputTokens - entry.lastReportedTokenUsage.inputTokens,
      outputTokens:
        usage.outputTokens - entry.lastReportedTokenUsage.outputTokens,
      totalTokens:
        usage.totalTokens - entry.lastReportedTokenUsage.totalTokens,
    };
    entry.tokenUsage.inputTokens += Math.max(0, delta.inputTokens);
    entry.tokenUsage.outputTokens += Math.max(0, delta.outputTokens);
    entry.tokenUsage.totalTokens += Math.max(0, delta.totalTokens);
    entry.lastReportedTokenUsage = { ...usage };
  }
}
