import { registerCommand } from "./index.ts";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveWorkflowPath, loadWorkflow } from "../workflow/loader.ts";
import { buildServiceConfig } from "../workflow/config.ts";
import { symphonySettings } from "../paths.ts";

interface ExportData {
  version: 1;
  exportedAt: string;
  tracker: {
    kind: string;
    config: Record<string, unknown>;
    credentials?: Record<string, string>;
  };
  agent: Record<string, unknown>;
  workspace: Record<string, unknown>;
  polling: Record<string, unknown>;
  promptTemplate: string;
}

async function configExportCommand(args: string[]): Promise<void> {
  const path = args.find((a) => !a.startsWith("-")) || process.cwd();
  const includeCredentials = args.includes("--include-credentials");
  const outputPath = args.find((a) => a.startsWith("--output="))
    ? args.find((a) => a.startsWith("--output="))!.split("=")[1]
    : null;

  const resolvedPath = resolveWorkflowPath(path);

  if (!existsSync(resolvedPath)) {
    console.error(`Workflow file not found: ${resolvedPath}`);
    console.error("Run 'opensymphony init' to create one.");
    process.exit(1);
  }

  const workflow = loadWorkflow(resolvedPath);
  const workflowDir = resolvedPath.substring(0, resolvedPath.lastIndexOf("/"));
  const config = buildServiceConfig(workflow.config, workflowDir);

  // Load credentials from settings.json
  let credentials: Record<string, string> | undefined;
  if (includeCredentials) {
    const settingsPath = symphonySettings();
    if (existsSync(settingsPath)) {
      try {
        const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
        const trackerSettings = settings.tracker?.[config.tracker.kind];
        if (trackerSettings) {
          credentials = trackerSettings as Record<string, string>;
        }
      } catch {
        console.error("Warning: Could not read settings.json for credentials");
      }
    }
  }

  const exportData: ExportData = {
    version: 1,
    exportedAt: new Date().toISOString(),
    tracker: {
      kind: config.tracker.kind,
      config: {
        ...config.tracker,
      },
      credentials: includeCredentials ? credentials : undefined,
    },
    agent: config.agent as unknown as Record<string, unknown>,
    workspace: config.workspace as unknown as Record<string, unknown>,
    polling: config.polling as unknown as Record<string, unknown>,
    promptTemplate: workflow.promptTemplate,
  };

  // Remove credential-like fields from tracker config for safety
  if (!includeCredentials) {
    const safeConfig = { ...exportData.tracker.config };
    delete safeConfig.app_id;
    delete safeConfig.app_secret;
    delete safeConfig.app_token;
    delete safeConfig.gitlab_token;
    delete safeConfig.api_key;
    delete safeConfig.github_token;
    exportData.tracker.config = safeConfig;
  }

  const json = JSON.stringify(exportData, null, 2);

  if (outputPath) {
    writeFileSync(resolve(outputPath), json + "\n");
    console.log(`Config exported to ${resolve(outputPath)}`);
  } else {
    console.log(json);
  }
}

registerCommand("config-export", configExportCommand);
