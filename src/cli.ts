function parseArgs(args: string[]): { workflowPath?: string; noTui: boolean } {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: symphony [options] [path-to-WORKFLOW.md]");
    console.log("  --no-tui    Run in headless mode (JSON logs to stdout)");
    console.log("  --help, -h  Show this help");
    process.exit(0);
  }
  const noTui = args.includes("--no-tui");
  const positional = args.filter((a) => !a.startsWith("-"));
  return { workflowPath: positional[0], noTui };
}

async function main() {
  const { workflowPath, noTui } = parseArgs(process.argv.slice(2));

  const useTui = !noTui && process.stdout.isTTY && process.env.TERM !== "dumb";
  if (useTui) {
    process.env.SYMPHONY_LOG_DEST = "stderr";
  }

  const { Orchestrator } = await import("./orchestrator/orchestrator.ts");
  const { WorkflowWatcher } = await import("./workflow/watcher.ts");
  const { loadWorkflow, resolveWorkflowPath } = await import("./workflow/loader.ts");
  const { buildServiceConfig, validateDispatchConfig } = await import("./workflow/config.ts");
  const { createTracker } = await import("./adapters/tracker/registry.ts");
  const { createAgent } = await import("./adapters/agent/registry.ts");
  const { WorkspaceManager } = await import("./workspace/manager.ts");
  const { logger } = await import("./logging/logger.ts");

  // Register built-in adapters
  await import("./adapters/tracker/feishu-bitable/register.ts");
  await import("./adapters/agent/claude-code/register.ts");

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

  const { TokenLog } = await import("./metrics/token-log.ts");
  const tokenLogPath = resolvedPath.substring(0, resolvedPath.lastIndexOf("/")) + "/.symphony-tokens.jsonl";
  const tokenLog = new TokenLog(tokenLogPath);

  // Create orchestrator
  const orchestrator = new Orchestrator({
    config,
    workflow,
    tracker,
    agent,
    workspaceManager,
    tokenLog,
  });

  // Dashboard (TUI mode)
  let dashboard: { start(): void; stop(): void } | null = null;
  if (useTui) {
    const { Dashboard } = await import("./tui/dashboard.ts");
    dashboard = new Dashboard(orchestrator);
  }

  // Start workflow watcher
  const watcher = new WorkflowWatcher();
  watcher.start(workflowPath, (result) => {
    if (result.ok) {
      orchestrator.updateConfig(result.config, result.workflow);
    }
  });

  // Graceful shutdown
  const shutdown = () => {
    if (dashboard) dashboard.stop();
    logger.info("Shutting down...");
    watcher.stop();
    orchestrator.stop();
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
