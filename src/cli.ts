import { Orchestrator } from "./orchestrator/orchestrator.ts";
import { WorkflowWatcher } from "./workflow/watcher.ts";
import { loadWorkflow, resolveWorkflowPath } from "./workflow/loader.ts";
import { buildServiceConfig, validateDispatchConfig } from "./workflow/config.ts";
import { createTracker } from "./adapters/tracker/registry.ts";
import { createAgent } from "./adapters/agent/registry.ts";
import { WorkspaceManager } from "./workspace/manager.ts";
import { logger } from "./logging/logger.ts";

// Register built-in adapters
import "./adapters/tracker/feishu-bitable/register.ts";
import "./adapters/agent/claude-code/register.ts";

function parseArgs(args: string[]): { workflowPath?: string } {
  if (args.length === 0) return {};
  if (args[0] === "--help" || args[0] === "-h") {
    console.log("Usage: symphony [path-to-WORKFLOW.md]");
    console.log("  If no path is given, uses ./WORKFLOW.md");
    process.exit(0);
  }
  return { workflowPath: args[0] };
}

async function main() {
  const { workflowPath } = parseArgs(process.argv.slice(2));
  const resolvedPath = resolveWorkflowPath(workflowPath);

  logger.info({ path: resolvedPath }, "Starting Symphony service");

  // Initial load
  const workflow = loadWorkflow(resolvedPath);
  const workflowDir = resolvedPath.substring(0, resolvedPath.lastIndexOf("/"));
  const config = buildServiceConfig(workflow.config, workflowDir);

  // Validate
  const validationError = validateDispatchConfig(config);
  if (validationError) {
    logger.fatal({ error: validationError }, "Startup validation failed");
    process.exit(1);
  }

  // Create adapters
  const tracker = createTracker(config.tracker.kind, config.tracker as unknown as Record<string, unknown>);
  const agentConfig = config.claude_code ?? { command: config.codex.command };
  const agent = createAgent("claude-code", agentConfig as unknown as Record<string, unknown>);

  // Create workspace manager
  const workspaceManager = new WorkspaceManager({
    root: config.workspace.root,
    hooks: config.hooks,
  });

  // Create orchestrator
  const orchestrator = new Orchestrator({
    config,
    workflow,
    tracker,
    agent,
    workspaceManager,
  });

  // Start workflow watcher
  const watcher = new WorkflowWatcher();
  watcher.start(workflowPath, (result) => {
    if (result.ok) {
      orchestrator.updateConfig(result.config, result.workflow);
    }
  });

  // Graceful shutdown
  const shutdown = () => {
    logger.info("Shutting down...");
    watcher.stop();
    orchestrator.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Start orchestrator
  await orchestrator.start();
  logger.info("Symphony service started");
}

main().catch((err) => {
  logger.fatal({ error: String(err) }, "Fatal error");
  process.exit(1);
});
