import { ANSI, colorize } from "./renderer.ts";
import { displayWidth, padCell, truncate, formatCount, formatRuntime, estimateCost, formatCost } from "./format.ts";
import { humanizeEvent, dotColor, formatRateLimits } from "./events.ts";
import type { Sparkline } from "./sparkline.ts";
import type { OrchestratorState, CompletedEntry } from "../orchestrator/state.ts";
import { effectiveTokenTotals } from "../orchestrator/state.ts";
import type { RunningEntry, RetryEntry, HistoryStats, PeriodStats } from "../model/index.ts";

const COL_ID = 10;
const COL_TITLE = 24;
const COL_STATE = 10;
const COL_AGE = 12;
const COL_TOKENS = 10;
const COL_EVENT_MIN = 12;
const ROW_CHROME = 10;

function terminalColumns(): number {
  return process.stdout.columns ?? 115;
}

function eventWidth(): number {
  const fixed = COL_ID + COL_TITLE + COL_STATE + COL_AGE + COL_TOKENS;
  return Math.max(COL_EVENT_MIN, terminalColumns() - fixed - ROW_CHROME);
}

export function formatHeader(
  state: OrchestratorState,
  sparkline: Sparkline,
  now: number,
  trackerUrl?: string | null,
): string[] {
  const agentCount = state.running.size;
  const maxAgents = state.maxConcurrentAgents;
  const completed = state.completed.size;
  const totals = effectiveTokenTotals(state);
  const currentTokens = totals.totalTokens;

  sparkline.sample(now, currentTokens);
  const tps = sparkline.tps(now, currentTokens);
  const graph = sparkline.render(now, currentTokens);
  const runtime = formatRuntime(totals.secondsRunning);

  let nextRefresh: string;
  if (state.nextTickAt == null) {
    nextRefresh = colorize("n/a", ANSI.gray);
  } else if (state.nextTickAt < now) {
    nextRefresh = colorize("refreshing...", ANSI.cyan);
  } else {
    const secs = Math.round((state.nextTickAt - now) / 1000);
    nextRefresh = colorize(`${secs}s`, ANSI.cyan);
  }

  return [
    colorize("╭─ OPENSYMPHONY STATUS", ANSI.bold),
    colorize("│ Agents: ", ANSI.bold) +
      colorize(String(agentCount), ANSI.green) +
      colorize("/", ANSI.gray) +
      colorize(String(maxAgents), ANSI.gray) +
      colorize(`  Completed: ${completed}`, ANSI.cyan),
    colorize("│ Throughput: ", ANSI.bold) +
      colorize(`${formatCount(Math.floor(tps))} tps`, ANSI.cyan) +
      "  " + graph,
    colorize("│ Runtime: ", ANSI.bold) + colorize(runtime, ANSI.magenta),
    colorize("│ Tokens: ", ANSI.bold) +
      colorize(`in ${formatCount(totals.inputTokens)}`, ANSI.yellow) +
      colorize(" | ", ANSI.gray) +
      colorize(`out ${formatCount(totals.outputTokens)}`, ANSI.yellow) +
      colorize(" | ", ANSI.gray) +
      colorize(`total ${formatCount(totals.totalTokens)}`, ANSI.yellow),
    colorize("│ Rate Limits: ", ANSI.bold) + colorize(formatRateLimits(state.rateLimits), ANSI.cyan),
    colorize("│ Est. Cost: ", ANSI.bold) + colorize(formatCost(estimateCost(totals.inputTokens, totals.outputTokens)), ANSI.yellow),
    colorize("│ Next refresh: ", ANSI.bold) + nextRefresh,
    ...(trackerUrl
      ? [colorize("│ Tracker: ", ANSI.bold) + colorize(trackerUrl, ANSI.cyan)]
      : []),
  ];
}

function formatPeriodStats(label: string, stats: PeriodStats, color: string): string {
  return colorize(label, color) +
    colorize(`${formatCount(stats.totalTokens)} tokens`, color) +
    colorize(` (${stats.issueCount} issues)`, ANSI.gray);
}

export function formatHistory(history: HistoryStats): string[] {
  const sep = colorize(" │ ", ANSI.gray);
  const line = formatPeriodStats("Today: ", history.today, ANSI.cyan) +
    sep +
    formatPeriodStats("Week: ", history.week, ANSI.magenta) +
    sep +
    formatPeriodStats("Month: ", history.month, ANSI.yellow);

  return [
    colorize("├─ History", ANSI.bold),
    "│ " + line,
  ];
}

export function formatRunningTable(state: OrchestratorState, maxHeight?: number): string[] {
  const running = [...state.running.values()].sort(
    (a, b) => a.identifier.localeCompare(b.identifier),
  );
  const ew = eventWidth();

  const header = [
    padCell("ID", COL_ID),
    padCell("TITLE", COL_TITLE),
    padCell("STATE", COL_STATE),
    padCell("AGE / TURN", COL_AGE),
    padCell("TOKENS", COL_TOKENS),
    padCell("EVENT", ew),
  ].join(" ");

  const sepWidth = COL_ID + COL_TITLE + COL_STATE + COL_AGE + COL_TOKENS + ew + 5;

  const lines: string[] = [
    colorize("├─ Running", ANSI.bold),
    "│",
    "│ " + colorize(header, ANSI.gray),
    "│ " + colorize("─".repeat(sepWidth), ANSI.gray),
  ];

  if (running.length === 0) {
    lines.push("│ " + colorize("No active agents", ANSI.gray));
    return lines;
  }

  const chromeLines = 4;
  const available = maxHeight != null && maxHeight > 0
    ? Math.max(1, maxHeight - chromeLines)
    : running.length;

  const visible = running.slice(0, available);
  const overflow = running.length - visible.length;

  for (const entry of visible) {
    lines.push(formatRunningRow(entry, ew));
  }

  if (overflow > 0) {
    lines.push("│ " + colorize(`  ... +${overflow} more`, ANSI.dim));
  }

  return lines;
}

function formatRunningRow(entry: RunningEntry, ew: number): string {
  const { text: evtText, color: evtColor } = humanizeEvent(entry.lastAgentEvent);
  const dc = dotColor(entry.lastAgentEvent);

  const id = truncate(entry.identifier, COL_ID);
  const title = truncate(entry.issue.title ?? "unknown", COL_TITLE);
  const stateStr = truncate(entry.issue.state, COL_STATE);
  const ageSeconds = (Date.now() - entry.startedAt.getTime()) / 1000;
  const bar = progressBar(entry.turnCount, 8);
  const ageStr = entry.turnCount > 0
    ? `${formatRuntime(ageSeconds)} ${bar}`
    : formatRuntime(ageSeconds);
  const tokens = formatCount(entry.tokenUsage.totalTokens);

  return [
    "│ ",
    colorize("●", colorizeCode(dc)),
    " ",
    colorize(padCell(id, COL_ID), ANSI.cyan),
    " ",
    colorize(padCell(title, COL_TITLE), ANSI.gray),
    " ",
    colorize(padCell(stateStr, COL_STATE), colorizeCode(evtColor)),
    " ",
    colorize(padCell(ageStr, COL_AGE), ANSI.magenta),
    " ",
    colorize(padCell(tokens, COL_TOKENS, "right"), ANSI.yellow),
    " ",
    colorize(padCell(truncate(evtText, ew), ew), colorizeCode(evtColor)),
  ].join("");
}

const PROGRESS_CHARS = ["░", "▓"];

function progressBar(turns: number, width: number): string {
  if (turns <= 0) return "";
  const filled = Math.min(turns, width);
  return PROGRESS_CHARS[1]!.repeat(filled) + PROGRESS_CHARS[0]!.repeat(Math.max(0, width - filled));
}

export function formatCompactHeader(
  state: OrchestratorState,
  sparkline: Sparkline,
  now: number,
): string[] {
  const agentCount = state.running.size;
  const maxAgents = state.maxConcurrentAgents;
  const completed = state.completed.size;
  const totals = effectiveTokenTotals(state);
  const tps = sparkline.tps(now, totals.totalTokens);
  const runtime = formatRuntime(totals.secondsRunning);

  const line = colorize("╭─ ", ANSI.bold) +
    colorize(`${agentCount}/${maxAgents}`, ANSI.green) +
    colorize(" agents ", ANSI.gray) +
    colorize(`${completed}`, ANSI.cyan) +
    colorize(" done │ ", ANSI.gray) +
    colorize(`${formatCount(Math.floor(tps))} tps`, ANSI.cyan) +
    colorize(" │ ", ANSI.gray) +
    colorize(runtime, ANSI.magenta) +
    colorize(" │ ", ANSI.gray) +
    colorize(`tokens ${formatCount(totals.totalTokens)}`, ANSI.yellow);

  return [line];
}

export function formatBackoffQueue(state: OrchestratorState): string[] {
  const retrying = [...state.retryAttempts.values()].sort(
    (a, b) => a.dueAtMs - b.dueAtMs,
  );

  const lines: string[] = [
    colorize("├─ Backoff queue", ANSI.bold),
  ];

  if (retrying.length === 0) {
    lines.push("│ " + colorize("No queued retries", ANSI.gray));
    return lines;
  }

  for (const entry of retrying) {
    lines.push(formatRetryRow(entry));
  }

  return lines;
}

function formatRetryRow(entry: RetryEntry): string {
  const dueIn = Math.max(0, entry.dueAtMs - Date.now());
  const secs = Math.floor(dueIn / 1000);
  const ms = String(dueIn % 1000).padStart(3, "0");
  const countdown = `${secs}.${ms}s`;

  let line = "│ " +
    colorize("↻", ANSI.yellow) + " " +
    colorize(entry.identifier, ANSI.red) + " " +
    colorize(`attempt=${entry.attempt}`, ANSI.yellow) +
    colorize(" in ", ANSI.dim) +
    colorize(countdown, ANSI.cyan);

  if (entry.error) {
    const sanitized = entry.error.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
    if (sanitized) {
      line += colorize(` error=${truncate(sanitized, 80)}`, ANSI.dim);
    }
  }

  return line;
}

function colorizeCode(name: string): string {
  const map: Record<string, string> = {
    red: ANSI.red,
    green: ANSI.green,
    yellow: ANSI.yellow,
    blue: ANSI.blue,
    magenta: ANSI.magenta,
    cyan: ANSI.cyan,
    gray: ANSI.gray,
  };
  return map[name] ?? ANSI.gray;
}

const COMPLETED_COLS = { id: 10, title: 24, tokens: 10, turns: 6, runtime: 12 };

export function formatCompletedTable(state: OrchestratorState): string[] {
  const entries = state.recentCompleted;
  if (entries.length === 0) return [];

  const { id: cId, title: cTitle, tokens: cTokens, turns: cTurns, runtime: cRuntime } = COMPLETED_COLS;

  const header = [
    padCell("ID", cId),
    padCell("TITLE", cTitle),
    padCell("TOKENS", cTokens),
    padCell("TURNS", cTurns),
    padCell("RUNTIME", cRuntime),
  ].join(" ");

  const sepWidth = cId + cTitle + cTokens + cTurns + cRuntime + 4;

  const lines: string[] = [
    colorize("├─ Recently Completed", ANSI.bold),
    "│ " + colorize(header, ANSI.gray),
    "│ " + colorize("─".repeat(sepWidth), ANSI.gray),
  ];

  for (const entry of entries) {
    lines.push(formatCompletedRow(entry));
  }

  return lines;
}

function formatCompletedRow(entry: CompletedEntry): string {
  const { id: cId, title: cTitle, tokens: cTokens, turns: cTurns, runtime: cRuntime } = COMPLETED_COLS;

  return "│ " +
    colorize("✔", ANSI.green) + " " +
    colorize(padCell(truncate(entry.identifier, cId), cId), ANSI.cyan) + " " +
    colorize(padCell(truncate(entry.title, cTitle), cTitle), ANSI.gray) + " " +
    colorize(padCell(formatCount(entry.totalTokens), cTokens, "right"), ANSI.yellow) + " " +
    colorize(padCell(String(entry.turns), cTurns), ANSI.gray) + " " +
    colorize(padCell(formatRuntime(entry.runtimeSeconds), cRuntime), ANSI.magenta);
}
