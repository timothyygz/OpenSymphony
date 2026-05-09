#!/usr/bin/env bun
import { dirname } from "node:path";
import pino from "pino";
import { getCommand } from "./commands/index.ts";
import type { ServiceConfig, WorkflowDefinition } from "./model/index.ts";

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

const COMMAND_MODULES: Record<string, () => Promise<void>> = {
  init: () => import("./commands/init.ts"),
  doctor: () => import("./commands/doctor.ts"),
  version: () => import("./commands/version.ts"),
  tasks: () => import("./commands/tasks.ts"),
  task: () => import("./commands/task.ts"),
  status: () => import("./commands/status.ts"),
  config: () => import("./commands/config.ts"),
};

// --- Types ---

export interface ParsedArgs {
  subcommand?: string;
  workflowPath?: string;
  unknownCommand?: string;
  noTui: boolean;
  json: boolean;
  stateFilter?: string;
  positional: string[];
  help: boolean;
}

interface DashboardLike {
  start(): void;
  stop(): void;
}

// --- Helpers ---

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

function looksLikeCommand(arg: string): boolean {
  return !arg.includes("/") && !arg.includes(".");
}

export function parseArgs(args: string[]): ParsedArgs {
  if (args.includes("--help") || args.includes("-h")) {
    return { noTui: false, json: false, positional: [], help: true };
  }

  const noTui = args.includes("--no-tui");
  const json = args.includes("--json");
  const positional = args.filter((a) => !a.startsWith("-"));

  const stateIdx = args.indexOf("--state");
  const stateFilter = stateIdx !== -1 && args[stateIdx + 1]
    ? args[stateIdx + 1]
    : undefined;

  const first = positional[0];
  if (first && SUBCOMMANDS.has(first)) {
    return { subcommand: first, noTui, json, stateFilter, positional: positional.slice(1), help: false };
  }
  if (first && looksLikeCommand(first)) {
    return { unknownCommand: first, noTui, json, positional: [], help: false };
  }
  return { workflowPath: first, noTui, json, positional: [], help: false };
}

// --- Subcommand handling ---

async function handleSubcommand(
  subcommand: string,
  positional: string[],
  flags: { json: boolean; stateFilter?: string; workflowPath?: string },
): Promise<void> {
  const loader = COMMAND_MODULES[subcommand];
  if (loader) {
    await loader();
  }

  const handler = getCommand(subcommand);
  if (!handler) {
    console.error(`Unknown command: ${subcommand}`);
    process.exit(1);
  }

  const cmdArgs = [...positional];
  if (flags.workflowPath) cmdArgs.push(flags.workflowPath);
  if (flags.json) process.env.OPENSYMPHONY_JSON = "1";
  if (flags.stateFilter) process.env.OPENSYMPHONY_STATE_FILTER = flags.stateFilter;
  await handler(cmdArgs);
}

// --- Orchestrator startup helpers ---

export async function loadWorkflowOrExit(resolvedPath: string): Promise<WorkflowDefinition> {
  const { loadWorkflow } = await import("./workflow/loader.ts");
  const { MissingWorkflowFileError } = await import("./errors/errors.ts");

  try {
    return loadWorkflow(resolvedPath);
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
}

export async function buildConfigAndValidate(
  workflow: WorkflowDefinition,
  workflowDir: string,
): Promise<ServiceConfig> {
  const { buildServiceConfig, validateDispatchConfig } = await import("./workflow/config.ts");
  const { logger } = await import("./logging/logger.ts");

  const config = buildServiceConfig(workflow.config, workflowDir);
  const validationError = validateDispatchConfig(config);
  if (validationError) {
    logger.fatal({ error: validationError }, "Startup validation failed");
    process.exit(1);
  }
  return config;
}

export interface OrchestratorServices {
  tracker: import("./adapters/tracker/types.ts").TrackerAdapter;
  agent: import("./adapters/agent/types.ts").AgentAdapter;
  workspaceManager: import("./workspace/manager.ts").WorkspaceManager;
  tokenStore: import("./metrics/token-store.ts").TokenStore;
  executionLog: import("./logging/execution-log.ts").ExecutionLog;
}

export async function createServices(
  config: ServiceConfig,
  workflowDir: string,
  logDir: string,
): Promise<OrchestratorServices> {
  const { createTracker } = await import("./adapters/tracker/registry.ts");
  const { createAgent } = await import("./adapters/agent/registry.ts");
  const { WorkspaceManager } = await import("./workspace/manager.ts");
  const { TokenStore } = await import("./metrics/token-store.ts");
  const { symphonyDb } = await import("./paths.ts");
  const { ExecutionLog } = await import("./logging/execution-log.ts");

  const tracker = createTracker(config.tracker.kind, { ...config.tracker });
  const agent = createAgent(config.agent.kind, config.agent.config);

  const workspaceManager = new WorkspaceManager({
    root: config.workspace.root,
    hooks: config.hooks,
    sources: config.workspace.sources ?? [],
    workflowDir,
  });

  const tokenStore = new TokenStore(symphonyDb());
  const executionLog = new ExecutionLog(`${logDir}/.symphony-execution.jsonl`);

  return { tracker, agent, workspaceManager, tokenStore, executionLog };
}

export function setupGracefulShutdown(deps: {
  orchestrator: import("./orchestrator/orchestrator.ts").Orchestrator;
  watcher: import("./workflow/watcher.ts").WorkflowWatcher;
  dashboard: DashboardLike | null;
  tokenStore: import("./metrics/token-store.ts").TokenStore;
  logger: pino.Logger;
}): void {
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (deps.dashboard) deps.dashboard.stop();
    deps.logger.info("Shutting down...");
    deps.watcher.stop();
    await deps.orchestrator.stop();
    deps.tokenStore.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// --- Orchestrator startup ---

async function startOrchestrator(workflowPath: string | undefined, noTui: boolean): Promise<void> {
  const useTui = !noTui && process.stdout.isTTY && process.env.TERM !== "dumb";
  if (useTui) {
    process.env.SYMPHONY_LOG_DEST = "stderr";
  }

  const { resolveWorkflowPath } = await import("./workflow/loader.ts");
  const { logger, setLogFilePath, ensureLogDir } = await import("./logging/logger.ts");
  const { Orchestrator } = await import("./orchestrator/orchestrator.ts");
  const { WorkflowWatcher } = await import("./workflow/watcher.ts");

  const resolvedPath = resolveWorkflowPath(workflowPath);
  const workflowDir = dirname(resolvedPath);

  const logDir = ensureLogDir();
  setLogFilePath(`${logDir}/symphony.log`);

  // Register built-in adapters (after log file is configured — these trigger logger.debug)
  await import("./adapters/tracker/feishu-bitable/register.ts");
  await import("./adapters/tracker/gitlab-issues/register.ts");
  await import("./adapters/agent/claude-code/register.ts");

  logger.info({ path: resolvedPath }, "Starting Symphony service");

  // Load, validate, and create services
  const workflow = await loadWorkflowOrExit(resolvedPath);
  const config = await buildConfigAndValidate(workflow, workflowDir);
  const services = await createServices(config, workflowDir, logDir);

  // Create orchestrator
  const orchestrator = new Orchestrator({
    config,
    workflow,
    ...services,
  });

  // Dashboard (TUI mode)
  let dashboard: DashboardLike | null = null;
  if (useTui) {
    const { Dashboard } = await import("./tui/dashboard.ts");
    const trackerUrl = services.tracker.getDashboardUrl?.() ?? null;
    dashboard = new Dashboard(orchestrator, services.tokenStore, trackerUrl);
  }

  // Start workflow watcher
  const watcher = new WorkflowWatcher();
  watcher.start(workflowPath, (result) => {
    if (result.ok) {
      orchestrator.updateConfig(result.config, result.workflow);
    }
  });

  // Graceful shutdown
  setupGracefulShutdown({ orchestrator, watcher, dashboard, tokenStore: services.tokenStore, logger });

  // Start orchestrator
  await orchestrator.start();

  // Start dashboard after orchestrator
  if (dashboard) dashboard.start();

  logger.info("Symphony service started");
}

// --- Entry point ---

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.unknownCommand) {
    console.error(`Unknown command: ${args.unknownCommand}`);
    console.error();
    console.error(`Use '${BINARY_NAME} --help' to see available commands.`);
    process.exit(1);
  }

  if (args.subcommand) {
    await handleSubcommand(args.subcommand, args.positional, {
      json: args.json,
      stateFilter: args.stateFilter,
      workflowPath: args.workflowPath,
    });
    return;
  }

  await startOrchestrator(args.workflowPath, args.noTui);
}

export function formatError(err: unknown): string {
  if (err instanceof Error) {
    return err.stack ?? err.message;
  }
  if (typeof err === "string") {
    return err;
  }
  try {
    return JSON.stringify(err);
  } catch (_e) {
    return String(err);
  }
}

main().catch((err) => {
  console.error("Fatal error:", formatError(err));
  process.exit(1);
});
