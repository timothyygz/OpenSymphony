import { appendFileSync } from "node:fs";
import { logger } from "./logger.ts";

// --- Event types ---

export type WorkerExitReason = "normal" | "failed" | "stall" | "external_cancel";

export type ExecutionEventType =
  | "dispatch"
  | "worker_spawn_failed"
  | "session_started"
  | "turn_completed"
  | "turn_failed"
  | "worker_exit"
  | "tracker_state_updated"
  | "stall_detected"
  | "retry_scheduled";

interface ExecutionEventBase {
  event: ExecutionEventType;
  timestamp: string;
  issueId: string;
  identifier: string;
}

export interface DispatchEvent extends ExecutionEventBase {
  event: "dispatch";
  attempt: number;
}

export interface WorkerSpawnFailedEvent extends ExecutionEventBase {
  event: "worker_spawn_failed";
  error: string;
}

export interface SessionStartedEvent extends ExecutionEventBase {
  event: "session_started";
  sessionId: string;
}

export interface TurnCompletedEvent extends ExecutionEventBase {
  event: "turn_completed";
  turn: number;
  inputTokens: number;
  outputTokens: number;
}

export interface TurnFailedEvent extends ExecutionEventBase {
  event: "turn_failed";
  turn: number;
  error: string;
}

export interface WorkerExitEvent extends ExecutionEventBase {
  event: "worker_exit";
  reason: WorkerExitReason;
  turns: number;
  totalTokens: number;
}

export interface TrackerStateUpdatedEvent extends ExecutionEventBase {
  event: "tracker_state_updated";
  fromState: string;
  toState: string;
}

export interface StallDetectedEvent extends ExecutionEventBase {
  event: "stall_detected";
  elapsed: number;
  timeout: number;
}

export interface RetryScheduledEvent extends ExecutionEventBase {
  event: "retry_scheduled";
  attempt: number;
  backoffMs: number;
  reason: string;
}

export type ExecutionEvent =
  | DispatchEvent
  | WorkerSpawnFailedEvent
  | SessionStartedEvent
  | TurnCompletedEvent
  | TurnFailedEvent
  | WorkerExitEvent
  | TrackerStateUpdatedEvent
  | StallDetectedEvent
  | RetryScheduledEvent;

// --- ExecutionLog class ---

export class ExecutionLog {
  constructor(private readonly filePath: string) {}

  append(event: ExecutionEvent): void {
    try {
      const line = JSON.stringify(event) + "\n";
      appendFileSync(this.filePath, line, "utf-8");
    } catch (err) {
      logger.warn({ filePath: this.filePath, error: String(err) }, "Execution log write failed");
    }
  }

  async queryByIdentifier(identifier: string): Promise<ExecutionEvent[]> {
    const file = Bun.file(this.filePath);
    if (!(await file.exists())) return [];

    const text = await file.text();
    const events: ExecutionEvent[] = [];
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const ev = JSON.parse(trimmed) as ExecutionEvent;
        if (ev.identifier === identifier) events.push(ev);
      } catch {
        // skip corrupted lines
      }
    }
    return events;
  }
}
