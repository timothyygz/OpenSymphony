import type { Issue, RunningEntry, RetryEntry, AggregateTotals } from "../model/index.ts";

export interface OrchestratorState {
  pollIntervalMs: number;
  maxConcurrentAgents: number;
  running: Map<string, RunningEntry>;
  claimed: Set<string>;
  retryAttempts: Map<string, RetryEntry>;
  completed: Set<string>;
  aggregateTotals: AggregateTotals;
  rateLimits: unknown;
  nextTickAt: number | null;
}

export function createInitialState(): OrchestratorState {
  return {
    pollIntervalMs: 30000,
    maxConcurrentAgents: 10,
    running: new Map(),
    claimed: new Set(),
    retryAttempts: new Map(),
    completed: new Set(),
    aggregateTotals: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      secondsRunning: 0,
    },
    rateLimits: null,
    nextTickAt: null,
  };
}

export function normalizeState(state: string): string {
  return state.trim();
}

export function isActiveState(state: string, activeStates: string[]): boolean {
  const normalized = normalizeState(state);
  return activeStates.some((s) => normalizeState(s) === normalized);
}

export function isTerminalState(state: string, terminalStates: string[]): boolean {
  const normalized = normalizeState(state);
  return terminalStates.some((s) => normalizeState(s) === normalized);
}

export function addRuntimeSeconds(state: OrchestratorState, entry: RunningEntry): void {
  const elapsed = (Date.now() - entry.startedAt.getTime()) / 1000;
  state.aggregateTotals.secondsRunning += elapsed;
}

export function addTokenUsage(state: OrchestratorState, entry: RunningEntry): void {
  state.aggregateTotals.inputTokens += entry.tokenUsage.inputTokens;
  state.aggregateTotals.outputTokens += entry.tokenUsage.outputTokens;
  state.aggregateTotals.totalTokens += entry.tokenUsage.totalTokens;
}

export function effectiveSecondsRunning(state: OrchestratorState): number {
  const ended = state.aggregateTotals.secondsRunning;
  const active = [...state.running.values()].reduce(
    (sum, r) => sum + (Date.now() - r.startedAt.getTime()) / 1000,
    0,
  );
  return ended + active;
}
