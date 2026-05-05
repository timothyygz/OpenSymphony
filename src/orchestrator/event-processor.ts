import type { AgentEvent } from "../adapters/agent/types.ts";
import type { RunningEntry } from "../model/index.ts";
import type { OrchestratorState } from "./state.ts";
import { updateMetaJson } from "../logging/turn-log.ts";
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

    if (event.usage) {
      this.trackTokenDeltas(entry, event.usage);
    }

    if (event.rateLimits) {
      this.deps.state.rateLimits = event.rateLimits;
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
