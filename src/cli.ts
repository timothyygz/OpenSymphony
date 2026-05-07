#!/usr/bin/env bun
import { getCommand, getCommandNames } from "./commands/index.ts";

const BINARY_NAME = "opensymphony";

const SUBCOMMANDS = new Set([
  "init",
  "doctor",
  "version",
  "tasks",
  "task",
  "status",
  "config",
]);

function printHelp(): void {
  console.log(`Usage: ${BINARY_NAME} <command> [options] [path]`);
  console.log();
  console.log("Commands:");
  console.log("  init [path]            Interactive setup wizard");
  console.log("  doctor [path]          System diagnostic");
  console.log("  version                Show version");
  console.log("  tasks [path]           List all tasks from kanban");
  console.log("  task <id> [path]       Show task detail");
  console.log("  status [path]          Kanban overview by state");
  console.log("  config [path]          Show current workflow config");
  console.log();
  console.log("Options:");
  console.log("  --no-tui               Run in headless mode (JSON logs to stdout)");
  console.log("  --state <state>        Filter by state (tasks command)");
  console.log("  --json                 Output as JSON");
  console.log("  --help, -h             Show this help");
  console.log();
  console.log("When no command is given, starts the orchestrator service.");
  console.log(`  ${BINARY_NAME} [path-to-WORKFLOW.md]`);
}

function parseArgs(args: string[]): { subcommand?: string; workflowPath?: string; noTui: boolean; json: boolean; stateFilter?: string; positional: string[] } {
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    process.exit(0);
  }
  const noTui = args.includes("--no-tui");
  const json = args.includes("--json");
  const positional = args.filter((a) => !a.startsWith("-"));

  // Extract --state <value>
  const stateIdx = args.indexOf("--state");
  let stateFilter: string | undefined;
  if (stateIdx !== -1 && args[stateIdx + 1]) {
    stateFilter = args[stateIdx + 1];
  }

  const first = positional[0];
  if (first && SUBCOMMANDS.has(first)) {
    // For commands like 'task <id>', the remaining positional after the subcommand
    // may include an id arg plus an optional path
    return { subcommand: first, workflowPath: undefined, noTui, json, stateFilter, positional: positional.slice(1) };
  }
  return { workflowPath: first, noTui, json, positional: [] };
}

async function main() {
  const { subcommand, workflowPath, noTui, json, stateFilter, positional } = parseArgs(process.argv.slice(2));

  if (subcommand) {
    // Import command modules to trigger registration
    if (subcommand === "init") await import("./commands/init.ts");
    else if (subcommand === "doctor") await import("./commands/doctor.ts");
    else if (subcommand === "version") await import("./commands/version.ts");
    else if (subcommand === "tasks") await import("./commands/tasks.ts");
    else if (subcommand === "task") await import("./commands/task.ts");
    else if (subcommand === "status") await import("./commands/status.ts");
    else if (subcommand === "config") await import("./commands/config.ts");

    const handler = getCommand(subcommand);
    if (!handler) {
      console.error(`Unknown command: ${subcommand}`);
      process.exit(1);
    }
    // Pass relevant args to the command handler
    const cmdArgs = positional;
    if (workflowPath) cmdArgs.push(workflowPath);
    // Attach flags via env for commands to read
    if (json) process.env.OPENSYMPHONY_JSON = "1";
    if (stateFilter) process.env.OPENSYMPHONY_STATE_FILTER = stateFilter;
    await handler(cmdArgs);
    return;
  }

  const useTui = !noTui && process.stdout.isTTY && process.env.TERM !== "dumb";
  if (useTui) {
    process.env.SYMPHONY_LOG_DEST = "stderr";
  }

  const { Orchestrator } = await import("./orchestrator/orchestrator.ts");
  const { WorkflowWatcher } = await import("./workflow/watcher.ts");
  const { loadWorkflow, resolveWorkflowPath } = await import("./workflow/loader.ts");
  const { MissingWorkflowFileError } = await import("./errors/errors.ts");
  const { buildServiceConfig, validateDispatchConfig } = await import("./workflow/config.ts");
  const { createTracker } = await import("./adapters/tracker/registry.ts");
  const { createAgent } = await import("./adapters/agent/registry.ts");
  const { WorkspaceManager } = await import("./workspace/manager.ts");
  const { logger, setLogFilePath, ensureLogDir } = await import("./logging/logger.ts");

  const resolvedPath = resolveWorkflowPath(workflowPath);
  const workflowDir = resolvedPath.substring(0, resolvedPath.lastIndexOf("/"));

  const logDir = ensureLogDir();
  setLogFilePath(`${logDir}/symphony.log`);

  // Register built-in adapters (after log file is configured — these trigger logger.debug)
  await import("./adapters/tracker/feishu-bitable/register.ts");
  await import("./adapters/agent/claude-code/register.ts");

  logger.info({ path: resolvedPath }, "Starting Symphony service");

  // Initial load
  let workflow;
  try {
    workflow = loadWorkflow(resolvedPath);
  } catch (err) {
    if (err instanceof MissingWorkflowFileError) {
      console.error(`Workflow file not found: ${resolvedPath}`);
      console.error();
      console.error("Run 'opensymphony init' to create one, or specify a path:");
      console.error("  opensymphony /path/to/WORKFLOW.md");
      process.exit(1);
    }
    throw err;
  }
  const config = buildServiceConfig(workflow.config, workflowDir);

  // Validate
  const validationError = validateDispatchConfig(config);
  if (validationError) {
    logger.fatal({ error: validationError }, "Startup validation failed");
    process.exit(1);
  }

  // Create adapters
  const tracker = createTracker(config.tracker.kind, config.tracker as unknown as Record<string, unknown>);
  const agent = createAgent(config.agent.kind, config.agent.config as Record<string, unknown>);

  // Create workspace manager
  const workspaceManager = new WorkspaceManager({
    root: config.workspace.root,
    hooks: config.hooks,
    sources: config.workspace.sources ?? [],
    workflowDir: workflowDir,
  });

  const { TokenLog } = await import("./metrics/token-log.ts");
  const tokenLogPath = `${logDir}/.symphony-tokens.jsonl`;
  const tokenLog = new TokenLog(tokenLogPath);

  const { ExecutionLog } = await import("./logging/execution-log.ts");
  const executionLogPath = `${logDir}/.symphony-execution.jsonl`;
  const executionLog = new ExecutionLog(executionLogPath);

  // Create orchestrator
  const orchestrator = new Orchestrator({
    config,
    workflow,
    tracker,
    agent,
    workspaceManager,
    tokenLog,
    executionLog,
  });

  // Dashboard (TUI mode)
  let dashboard: { start(): void; stop(): void } | null = null;
  if (useTui) {
    const { Dashboard } = await import("./tui/dashboard.ts");
    const trackerUrl = config.tracker.kind === "feishu_bitable" && config.tracker.app_token && config.tracker.table_id
      ? `https://mbyzmxekdm.feishu.cn/base/${config.tracker.app_token}?table=${config.tracker.table_id}`
      : null;
    dashboard = new Dashboard(orchestrator, tokenLogPath, trackerUrl);
  }

  // Start workflow watcher
  const watcher = new WorkflowWatcher();
  watcher.start(workflowPath, (result) => {
    if (result.ok) {
      orchestrator.updateConfig(result.config, result.workflow);
    }
  });

  // Graceful shutdown
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    if (dashboard) dashboard.stop();
    logger.info("Shutting down...");
    watcher.stop();
    await orchestrator.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Start orchestrator
  await orchestrator.start();

  // Start dashboard after orchestrator
  if (dashboard) dashboard.start();

  logger.info("Symphony service started");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
