import { registerCommand } from "./index.ts";
import { bootstrapTracker } from "./bootstrap.ts";

async function tasksCommand(args: string[]): Promise<void> {
  const { tracker, config } = await bootstrapTracker(args);
  const json = process.env.OPENSYMPHONY_JSON === "1";
  const stateFilter = process.env.OPENSYMPHONY_STATE_FILTER;

  let issues;
  if (stateFilter) {
    issues = await tracker.fetchIssuesByStates([stateFilter]);
  } else {
    // Fetch all by combining active and terminal states
    const allStates = [
      ...(config.tracker.active_states ?? []),
      ...(config.tracker.terminal_states ?? []),
    ];
    if (allStates.length > 0) {
      issues = await tracker.fetchIssuesByStates(allStates);
    } else {
      issues = await tracker.fetchCandidateIssues();
    }
  }

  if (json) {
    console.log(JSON.stringify(issues, null, 2));
    return;
  }

  if (issues.length === 0) {
    console.log("No tasks found.");
    return;
  }

  // Table output
  const idWidth = Math.max(3, ...issues.map((i) => (i.identifier ?? i.id).length));
  const stateWidth = Math.max(5, ...issues.map((i) => i.state.length));

  console.log(`${"ID".padEnd(idWidth)}  ${"State".padEnd(stateWidth)}  Title`);
  console.log("-".repeat(idWidth) + "  " + "-".repeat(stateWidth) + "  " + "-".repeat(20));
  for (const issue of issues) {
    const id = issue.identifier ?? issue.id;
    console.log(`${id.padEnd(idWidth)}  ${issue.state.padEnd(stateWidth)}  ${issue.title}`);
  }
  console.log();
  console.log(`Total: ${issues.length} task${issues.length === 1 ? "" : "s"}`);
}

registerCommand("tasks", tasksCommand);
