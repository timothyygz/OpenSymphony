import { registerCommand } from "./index.ts";
import { existsSync } from "node:fs";
import { resolveWorkflowPath, loadWorkflow } from "../workflow/loader.ts";
import { buildServiceConfig, validateDispatchConfig } from "../workflow/config.ts";

async function configCommand(args: string[]): Promise<void> {
  const path = args.find((a) => !a.startsWith("-")) || process.cwd();
  const resolvedPath = resolveWorkflowPath(path);
  const json = process.env.OPENSYMPHONY_JSON === "1";

  if (!existsSync(resolvedPath)) {
    console.error(`Workflow file not found: ${resolvedPath}`);
    console.error("Run 'opensymphony init' to create one.");
    process.exit(1);
  }

  const workflow = loadWorkflow(resolvedPath);
  const workflowDir = resolvedPath.substring(0, resolvedPath.lastIndexOf("/"));
  const config = buildServiceConfig(workflow.config, workflowDir);

  const validationError = validateDispatchConfig(config);

  if (json) {
    console.log(JSON.stringify({
      workflow_path: resolvedPath,
      valid: !validationError,
      validation_error: validationError ?? undefined,
      tracker: config.tracker,
      agent: config.agent,
      workspace: config.workspace,
      polling: config.polling,
    }, null, 2));
    return;
  }

  console.log(`Workflow:     ${resolvedPath}`);
  console.log(`Valid:        ${validationError ? "NO - " + validationError : "Yes"}`);
  console.log();
  console.log("Tracker:");
  console.log(`  Kind:       ${config.tracker.kind}`);
  console.log(`  App Token:  ${config.tracker.app_token ?? "N/A"}`);
  console.log(`  Table ID:   ${config.tracker.table_id ?? "N/A"}`);
  console.log();
  console.log("Agent:");
  console.log(`  Kind:       ${config.agent.kind}`);
  console.log(`  Max Turns:  ${config.agent.max_turns ?? "unlimited"}`);
  console.log(`  Concurrent: ${config.agent.max_concurrent_agents ?? 1}`);
  console.log();
  console.log("States:");
  console.log(`  Active:     ${(config.tracker.active_states ?? []).join(", ") || "none"}`);
  console.log(`  Terminal:   ${(config.tracker.terminal_states ?? []).join(", ") || "none"}`);
  console.log();
  console.log("Workspace:");
  console.log(`  Root:       ${config.workspace.root}`);
  const sources = config.workspace.sources ?? [];
  if (sources.length > 0) {
    for (const src of sources) {
      console.log(`  Source:     ${src.type} - ${(src as { url?: string }).url ?? "N/A"}`);
    }
  } else {
    console.log(`  Sources:    none`);
  }
  console.log();
  console.log("Polling:");
  console.log(`  Interval:   ${config.polling?.interval_ms ?? 30000}ms`);
}

registerCommand("config", configCommand);
