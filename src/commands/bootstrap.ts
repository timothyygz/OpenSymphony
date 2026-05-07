import { existsSync } from "node:fs";
import { resolveWorkflowPath, loadWorkflow } from "../workflow/loader.ts";
import { buildServiceConfig, validateDispatchConfig } from "../workflow/config.ts";
import { createTracker } from "../adapters/tracker/registry.ts";
import type { TrackerAdapter } from "../adapters/tracker/types.ts";
import type { ServiceConfig } from "../model/workflow.ts";

export interface BootstrapResult {
  config: ServiceConfig;
  tracker: TrackerAdapter;
}

/**
 * Load workflow config, validate it, and create a tracker adapter.
 * Exits with an error message if workflow file is missing or invalid.
 */
export async function bootstrapTracker(args: string[]): Promise<BootstrapResult> {
  const path = args.find((a) => !a.startsWith("-")) || process.cwd();
  const resolvedPath = resolveWorkflowPath(path);

  if (!existsSync(resolvedPath)) {
    console.error(`Workflow file not found: ${resolvedPath}`);
    console.error("Run 'opensymphony init' to create one.");
    process.exit(1);
  }

  const workflow = loadWorkflow(resolvedPath);
  const workflowDir = resolvedPath.substring(0, resolvedPath.lastIndexOf("/"));
  const config = buildServiceConfig(workflow.config, workflowDir);

  const validationError = validateDispatchConfig(config);
  if (validationError) {
    console.error(`Config validation failed: ${validationError}`);
    process.exit(1);
  }

  // Register built-in tracker adapters
  await import("../adapters/tracker/feishu-bitable/register.ts");

  const tracker = createTracker(config.tracker.kind, config.tracker as unknown as Record<string, unknown>);

  return { config, tracker };
}
