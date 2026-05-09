import { registerCommand } from "./index.ts";
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { symphonyHome, symphonySettings, symphonyWorkflow } from "../paths.ts";
import { homedir } from "node:os";
import { objectToYaml, loadTemplate } from "../setup/yaml.ts";
import { validateImportData } from "../setup/validate.ts";
import type { ExportData } from "../setup/types.ts";
import { availableTrackerKinds } from "../adapters/tracker/registry.ts";

async function configImportCommand(args: string[]): Promise<void> {
  const inputFile = args.find((a) => !a.startsWith("-"));
  if (!inputFile) {
    console.error("Usage: opensymphony config-import <file.json>");
    process.exit(1);
  }

  const inputPath = resolve(inputFile);
  if (!existsSync(inputPath)) {
    console.error(`File not found: ${inputPath}`);
    process.exit(1);
  }

  let rawData: unknown;
  try {
    rawData = JSON.parse(readFileSync(inputPath, "utf-8"));
  } catch (err) {
    console.error(`Failed to parse JSON: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  // Validate the import data structure
  const validation = validateImportData(rawData);
  if (!validation.valid) {
    console.error("Invalid import file:");
    for (const err of validation.errors) {
      console.error(`  - ${err.message}`);
      if (err.suggestion) console.error(`    Suggestion: ${err.suggestion}`);
    }
    process.exit(1);
  }

  const data = rawData as ExportData;

  // Validate that the tracker kind is known
  // Ensure tracker adapters are registered so availableTrackerKinds() works
  await import("../adapters/tracker/feishu-bitable/register.ts");
  await import("../adapters/tracker/gitlab-issues/register.ts");
  await import("../adapters/tracker/github-issues/register.ts");
  const validKinds = availableTrackerKinds();
  if (!validKinds.includes(data.tracker.kind)) {
    console.error(`Unknown tracker kind: "${data.tracker.kind}". Available kinds: ${validKinds.join(", ")}`);
    process.exit(1);
  }

  // Build the workflow YAML
  const trackerYaml = objectToYaml(data.tracker.config, 1);
  const workspaceYaml = objectToYaml(data.workspace, 1);

  // Load template for agent config
  const template = loadTemplate("workflow-config.yaml");

  const agentConfig = data.agent as Record<string, unknown>;
  const innerConfig = agentConfig.config as Record<string, unknown> | undefined;
  const approvalPolicy = String(innerConfig?.approval_policy ?? "auto");

  let yaml = template
    .replace(/^tracker:[\s\S]*?(?=\npolling:)/m, "")
    .replace("{{ workspace }}", workspaceYaml)
    .replace("{{ approval_policy }}", approvalPolicy);

  yaml = `tracker:\n${trackerYaml}\n${yaml}`;

  const workflowContent = `---\n${yaml}\n---\n\n${data.promptTemplate}\n`;

  // Determine output path
  const home = homedir();
  const workflowPath = symphonyWorkflow(home);
  const workflowDir = workflowPath.substring(0, workflowPath.lastIndexOf("/"));
  const settingsPath = symphonySettings(home);
  const settingsDir = symphonyHome(home);

  // Backup existing files before writing
  const workflowBackup = existsSync(workflowPath) ? workflowPath + ".bak" : null;
  const settingsBackup = existsSync(settingsPath) ? settingsPath + ".bak" : null;
  if (workflowBackup) copyFileSync(workflowPath, workflowBackup);
  if (settingsBackup) copyFileSync(settingsPath, settingsBackup);

  try {
    // Write WORKFLOW.md
    if (!existsSync(workflowDir)) {
      mkdirSync(workflowDir, { recursive: true });
    }
    writeFileSync(workflowPath, workflowContent);
    console.log(`WORKFLOW.md written to ${workflowPath}`);

    // Write credentials to settings.json
    if (data.tracker.credentials) {
      let settings: Record<string, unknown> = {};
      if (existsSync(settingsPath)) {
        try {
          settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
        } catch {
          settings = {};
        }
      }

      if (!settings.tracker) settings.tracker = {};
      const kind = data.tracker.kind;
      (settings.tracker as Record<string, Record<string, unknown>>)[kind] = {
        ...data.tracker.credentials,
      };

      if (!existsSync(settingsDir)) {
        mkdirSync(settingsDir, { recursive: true });
      }
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
      console.log(`Credentials written to ${settingsPath}`);
    } else {
      console.log("No credentials found in import file. You may need to configure credentials manually.");
    }

    // Clean up backups on success
    if (workflowBackup) unlinkSync(workflowBackup);
    if (settingsBackup) unlinkSync(settingsBackup);

    console.log("Import complete.");
  } catch (err) {
    // Restore backups on failure
    if (workflowBackup && existsSync(workflowBackup)) {
      copyFileSync(workflowBackup, workflowPath);
      unlinkSync(workflowBackup);
    }
    if (settingsBackup && existsSync(settingsBackup)) {
      copyFileSync(settingsBackup, settingsPath);
      unlinkSync(settingsBackup);
    }
    console.error(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    console.error("Previous configuration has been restored from backup.");
    process.exit(1);
  }
}

registerCommand("config-import", configImportCommand);
