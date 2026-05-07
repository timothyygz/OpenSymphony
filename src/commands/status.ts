import { registerCommand } from "./index.ts";
import { bootstrapTracker } from "./bootstrap.ts";

async function statusCommand(args: string[]): Promise<void> {
  const { tracker, config } = await bootstrapTracker(args);
  const json = process.env.OPENSYMPHONY_JSON === "1";

  const allStates = [
    ...(config.tracker.active_states ?? []),
    ...(config.tracker.terminal_states ?? []),
  ];
  const issues = allStates.length > 0
    ? await tracker.fetchIssuesByStates(allStates)
    : await tracker.fetchCandidateIssues();

  // Group by state
  const byState = new Map<string, number>();
  for (const issue of issues) {
    byState.set(issue.state, (byState.get(issue.state) ?? 0) + 1);
  }

  // Sort: active states first, then terminal, then others
  const activeStates = new Set(config.tracker.active_states ?? []);
  const terminalStates = new Set(config.tracker.terminal_states ?? []);

  const sortedStates = [...byState.entries()].sort(([a], [b]) => {
    const aActive = activeStates.has(a);
    const bActive = activeStates.has(b);
    const aTerminal = terminalStates.has(a);
    const bTerminal = terminalStates.has(b);
    if (aActive !== bActive) return aActive ? -1 : 1;
    if (aTerminal !== bTerminal) return aTerminal ? 1 : -1;
    return a.localeCompare(b);
  });

  if (json) {
    const result: Record<string, number> = {};
    for (const [state, count] of sortedStates) {
      result[state] = count;
    }
    console.log(JSON.stringify({ total: issues.length, by_state: result }, null, 2));
    return;
  }

  console.log("Kanban Status");
  console.log("=".repeat(40));
  const countWidth = Math.max(5, ...sortedStates.map(([, c]) => String(c).length));
  for (const [state, count] of sortedStates) {
    const marker = activeStates.has(state) ? "●" : terminalStates.has(state) ? "✓" : "○";
    console.log(`  ${marker} ${state.padEnd(20)} ${String(count).padStart(countWidth)}`);
  }
  console.log("-".repeat(40));
  console.log(`  ${"Total".padEnd(20)} ${String(issues.length).padStart(countWidth)}`);
}

registerCommand("status", statusCommand);
