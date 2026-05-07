import { enterAltScreen, exitAltScreen, drawLines } from "./renderer.ts";
import { formatHeader, formatHistory, formatRunningTable, formatBackoffQueue } from "./layout.ts";
import { Sparkline } from "./sparkline.ts";
import type { TokenStore } from "../metrics/token-store.ts";
import type { Orchestrator } from "../orchestrator/orchestrator.ts";
import type { HistoryStats } from "../model/session.ts";

const DEFAULT_REFRESH_MS = 1000;
const HISTORY_REFRESH_MS = 30_000;

export class Dashboard {
  private readonly orchestrator: Orchestrator;
  private readonly refreshMs: number;
  private readonly sparkline = new Sparkline();
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private resizeHandler: (() => void) | null = null;
  private lastFingerprint: string | null = null;
  private lastRenderAt = 0;
  private readonly minIdleRerenderMs = 1000;

  private readonly tokenStore: TokenStore;
  private readonly trackerUrl: string | null;
  private cachedHistory: HistoryStats | null = null;
  private lastHistoryQueryAt = 0;

  constructor(orchestrator: Orchestrator, tokenStore: TokenStore, trackerUrl?: string | null) {
    this.orchestrator = orchestrator;
    this.tokenStore = tokenStore;
    this.trackerUrl = trackerUrl ?? null;
    this.refreshMs = parseInt(process.env.SYMPHONY_TUI_REFRESH_MS ?? "", 10) || DEFAULT_REFRESH_MS;
  }

  start(): void {
    enterAltScreen();

    this.resizeHandler = () => {
      this.forceRender();
    };
    process.stdout.on("resize", this.resizeHandler);

    this.intervalHandle = setInterval(() => {
      this.render();
    }, this.refreshMs);

    this.render();
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    if (this.resizeHandler) {
      process.stdout.off("resize", this.resizeHandler);
      this.resizeHandler = null;
    }
    exitAltScreen();
  }

  private render(): void {
    const now = Date.now();
    const state = this.orchestrator.getState();
    const fp = stateFingerprint(state);

    if (fp === this.lastFingerprint && !this.idleRerenderDue(now)) {
      return;
    }

    this.lastFingerprint = fp;
    this.lastRenderAt = now;

    const history = this.getHistory(now);

    const header = formatHeader(state, this.sparkline, now, this.trackerUrl);
    const historyLines = formatHistory(history);
    const table = formatRunningTable(state);
    const backoff = formatBackoffQueue(state);

    const lines = [
      ...header,
      ...historyLines,
      ...table,
      "",
      ...backoff,
      "╰─",
    ];

    drawLines(lines);
  }

  private getHistory(now: number): HistoryStats {
    if (this.cachedHistory && now - this.lastHistoryQueryAt < HISTORY_REFRESH_MS) {
      return this.cachedHistory;
    }

    this.cachedHistory = this.tokenStore.aggregate();
    this.lastHistoryQueryAt = now;
    return this.cachedHistory;
  }

  private forceRender(): void {
    this.lastFingerprint = null;
    this.render();
  }

  private idleRerenderDue(now: number): boolean {
    return now - this.lastRenderAt >= this.minIdleRerenderMs;
  }
}

function stateFingerprint(state: {
  running: Map<string, RunningEntry>;
  retryAttempts: Map<string, RetryEntry>;
  completed: Set<string>;
  aggregateTotals: { totalTokens: number; secondsRunning: number };
}): string {
  const running = [...state.running.values()]
    .map((e) => `${e.identifier}:${e.lastAgentEvent}:${e.turnCount}:${e.tokenUsage.totalTokens}`)
    .join("|");
  const retry = [...state.retryAttempts.values()]
    .map((e) => `${e.identifier}:${e.dueAtMs}`)
    .join("|");
  const totals = `${state.aggregateTotals.totalTokens}:${Math.floor(state.aggregateTotals.secondsRunning)}`;
  return `${running}|${retry}|${state.completed.size}|${totals}`;
}

type RunningEntry = {
  identifier: string;
  lastAgentEvent: string | null;
  turnCount: number;
  tokenUsage: { totalTokens: number };
};

type RetryEntry = {
  identifier: string;
  dueAtMs: number;
};
