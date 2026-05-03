import type { OrchestratorState } from "./state.ts";
import type { RetryEntry } from "../model/index.ts";
import { logger } from "../logging/logger.ts";

const CONTINUATION_DELAY_MS = 1000;
const BASE_BACKOFF_MS = 10000;

export function scheduleRetry(
  state: OrchestratorState,
  issueId: string,
  identifier: string,
  attempt: number,
  error: string | null,
  maxRetryBackoffMs: number,
  onRetryTimer: (issueId: string) => void,
  continuation = false,
): void {
  // Cancel existing retry timer
  const existing = state.retryAttempts.get(issueId);
  if (existing?.timerHandle) {
    clearTimeout(existing.timerHandle);
  }

  const delay = continuation
    ? CONTINUATION_DELAY_MS
    : Math.min(BASE_BACKOFF_MS * Math.pow(2, attempt - 1), maxRetryBackoffMs);

  const dueAtMs = Date.now() + delay;
  const timerHandle = setTimeout(() => onRetryTimer(issueId), delay);

  const entry: RetryEntry = {
    issueId,
    identifier,
    attempt,
    dueAtMs,
    timerHandle,
    error,
  };

  state.retryAttempts.set(issueId, entry);
  logger.debug({ issueId, identifier, attempt, delay, continuation, error }, "Retry scheduled");
}

export function cancelRetry(state: OrchestratorState, issueId: string): void {
  const entry = state.retryAttempts.get(issueId);
  if (entry?.timerHandle) {
    clearTimeout(entry.timerHandle);
  }
  state.retryAttempts.delete(issueId);
}
