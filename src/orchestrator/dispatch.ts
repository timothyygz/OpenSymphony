import type { Issue } from "../model/index.ts";
import type { OrchestratorState } from "./state.ts";

export function sortForDispatch(issues: Issue[]): Issue[] {
  return [...issues].sort((a, b) => {
    // Priority ascending (null last)
    const pa = a.priority ?? Number.MAX_SAFE_INTEGER;
    const pb = b.priority ?? Number.MAX_SAFE_INTEGER;
    if (pa !== pb) return pa - pb;

    // Created at ascending (oldest first)
    const ca = a.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const cb = b.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (ca !== cb) return ca - cb;

    // Identifier lexicographic
    return a.identifier.localeCompare(b.identifier);
  });
}

export function canDispatch(
  issue: Issue,
  state: OrchestratorState,
  maxConcurrentAgents: number,
  maxConcurrentAgentsByState: Map<string, number>,
  activeStates: string[],
): boolean {
  // Must have required fields
  if (!issue.id || !issue.identifier || !issue.title || !issue.state) return false;

  // Must be in active states
  if (!activeStates.some((s) => s.trim() === issue.state.trim())) return false;

  // Not already running or claimed
  if (state.running.has(issue.id)) return false;
  if (state.claimed.has(issue.id)) return false;

  // Global concurrency
  if (state.running.size >= maxConcurrentAgents) return false;

  // Per-state concurrency
  const normalizedState = issue.state.trim();
  const stateLimit = maxConcurrentAgentsByState.get(normalizedState);
  if (stateLimit !== undefined) {
    const runningInState = [...state.running.values()]
      .filter((r) => r.issue.state.trim() === normalizedState).length;
    if (runningInState >= stateLimit) return false;
  }

  return true;
}

export function availableSlots(state: OrchestratorState, maxConcurrentAgents: number): number {
  return Math.max(maxConcurrentAgents - state.running.size, 0);
}
