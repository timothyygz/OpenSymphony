import { registerCommand } from "./index.ts";
import { bootstrapTracker } from "./bootstrap.ts";

async function taskCommand(args: string[]): Promise<void> {
  if (args.length === 0 || args[0].startsWith("-")) {
    console.error("Usage: opensymphony task <id> [path]");
    console.error();
    console.error("  <id>   Task identifier or record ID");
    process.exit(1);
  }

  const taskId = args[0];
  const { tracker, config } = await bootstrapTracker(args.slice(1));
  const json = process.env.OPENSYMPHONY_JSON === "1";

  // Try fetching by states and filtering, since there's no single-issue fetch
  const allStates = [
    ...(config.tracker.active_states ?? []),
    ...(config.tracker.terminal_states ?? []),
  ];
  const issues = allStates.length > 0
    ? await tracker.fetchIssuesByStates(allStates)
    : await tracker.fetchCandidateIssues();

  const issue = issues.find(
    (i) => i.identifier === taskId || i.id === taskId,
  );

  if (!issue) {
    console.error(`Task not found: ${taskId}`);
    process.exit(1);
  }

  if (json) {
    console.log(JSON.stringify(issue, null, 2));
    return;
  }

  console.log(`ID:          ${issue.identifier ?? issue.id}`);
  console.log(`Record ID:   ${issue.id}`);
  console.log(`Title:       ${issue.title}`);
  console.log(`State:       ${issue.state}`);
  if (issue.priority !== null) console.log(`Priority:    ${issue.priority}`);
  if (issue.branchName) console.log(`Branch:      ${issue.branchName}`);
  if (issue.url) console.log(`URL:         ${issue.url}`);
  if (issue.labels.length > 0) console.log(`Labels:      ${issue.labels.join(", ")}`);
  if (issue.createdAt) console.log(`Created:     ${issue.createdAt.toISOString()}`);
  if (issue.updatedAt) console.log(`Updated:     ${issue.updatedAt.toISOString()}`);
  if (issue.blockedBy.length > 0) {
    console.log(`Blocked by:  ${issue.blockedBy.map((b) => b.identifier ?? b.id).join(", ")}`);
  }
  if (issue.description) {
    console.log();
    console.log("--- Description ---");
    console.log(issue.description);
  }
}

registerCommand("task", taskCommand);
