import { ANSI, colorize } from "./renderer.ts";
import { displayWidth, padCell, truncate, formatCount, formatRuntime } from "./format.ts";
import { humanizeEvent, dotColor, formatRateLimits } from "./events.ts";
import type { Sparkline } from "./sparkline.ts";
import type { OrchestratorState } from "../orchestrator/state.ts";
import type { RunningEntry, RetryEntry } from "../model/index.ts";

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
): string[] {
  const agentCount = state.running.size;
  const maxAgents = state.maxConcurrentAgents;
  const completed = state.completed.size;
  const totals = state.aggregateTotals;
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
    colorize("│ Next refresh: ", ANSI.bold) + nextRefresh,
  ];
}

export function formatRunningTable(state: OrchestratorState): string[] {
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

  for (const entry of running) {
    lines.push(formatRunningRow(entry, ew));
  }

  return lines;
}

function formatRunningRow(entry: RunningEntry, ew: number): string {
  const { text: evtText, color: evtColor } = humanizeEvent(entry.lastCodexEvent);
  const dc = dotColor(entry.lastCodexEvent);

  const id = truncate(entry.identifier, COL_ID);
  const title = truncate(entry.issue.title ?? "unknown", COL_TITLE);
  const stateStr = truncate(entry.issue.state, COL_STATE);
  const ageSeconds = (Date.now() - entry.startedAt.getTime()) / 1000;
  const ageStr = entry.turnCount > 0
    ? `${formatRuntime(ageSeconds)} / ${entry.turnCount}`
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
