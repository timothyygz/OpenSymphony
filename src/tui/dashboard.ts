import { enterAltScreen, exitAltScreen, drawLines } from "./renderer.ts";
import { formatHeader, formatRunningTable, formatBackoffQueue } from "./layout.ts";
import { Sparkline } from "./sparkline.ts";
import type { Orchestrator } from "../orchestrator/orchestrator.ts";

const DEFAULT_REFRESH_MS = 1000;

export class Dashboard {
  private readonly orchestrator: Orchestrator;
  private readonly refreshMs: number;
  private readonly sparkline = new Sparkline();
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private resizeHandler: (() => void) | null = null;
  private lastFingerprint: string | null = null;
  private lastRenderAt = 0;
  private readonly minIdleRerenderMs = 1000;

  constructor(orchestrator: Orchestrator) {
    this.orchestrator = orchestrator;
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

    const header = formatHeader(state, this.sparkline, now);
    const table = formatRunningTable(state);
    const backoff = formatBackoffQueue(state);

    const lines = [
      ...header,
      ...table,
      "",
      ...backoff,
      "╰─",
    ];

    drawLines(lines);
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
    .map((e) => `${e.identifier}:${e.lastCodexEvent}:${e.turnCount}:${e.tokenUsage.totalTokens}`)
    .join("|");
  const retry = [...state.retryAttempts.values()]
    .map((e) => `${e.identifier}:${e.dueAtMs}`)
    .join("|");
  const totals = `${state.aggregateTotals.totalTokens}:${Math.floor(state.aggregateTotals.secondsRunning)}`;
  return `${running}|${retry}|${state.completed.size}|${totals}`;
}

type RunningEntry = {
  identifier: string;
  lastCodexEvent: string | null;
  turnCount: number;
  tokenUsage: { totalTokens: number };
};

type RetryEntry = {
  identifier: string;
  dueAtMs: number;
};
