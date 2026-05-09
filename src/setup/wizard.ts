import { existsSync, writeFileSync, readFileSync, mkdirSync, unlinkSync, copyFileSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { symphonyHome, symphonySettings } from "../paths.ts";
import type { InitDeps, WizardResult } from "./types.ts";
import { buildWorkflowYaml } from "./yaml.ts";
import { validateWizardResult } from "./validate.ts";
import { generateTrackerSkill } from "./skill-generator.ts";
import {
  checkExistingWorkflow,
  stepTracker,
  stepAgent,
  stepWorkspace,
  stepTemplate,
  writeGlobalSettings,
} from "./steps.ts";
import { parseArgs, type InitArgs } from "./args.ts";
import { nonInteractiveInit } from "./non-interactive.ts";
import { wizardResultToExportData, writeExportFile } from "./export.ts";

// --- Backup/restore helpers for error recovery ---

function backupIfExists(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  const backupPath = filePath + ".pre-setup.bak";
  copyFileSync(filePath, backupPath);
  return backupPath;
}

function restoreBackup(backupPath: string, originalPath: string): void {
  if (existsSync(backupPath)) {
    renameSync(backupPath, originalPath);
  }
}

function cleanupBackup(backupPath: string | null): void {
  if (backupPath && existsSync(backupPath)) {
    unlinkSync(backupPath);
  }
}

/**
 * Write workflow and settings with atomic-like error recovery.
 * Backs up existing files before writing; on failure, restores them.
 */
async function writeConfigWithRecovery(
  targetPath: string,
  workflowContent: string,
  result: WizardResult,
  prompts: InitDeps["prompts"],
  homeDir: string,
): Promise<boolean> {
  const outputPath = resolve(targetPath, "WORKFLOW.md");
  const settingsPath = symphonySettings(homeDir);

  // Back up existing files
  const workflowBackup = backupIfExists(outputPath);
  const settingsBackup = backupIfExists(settingsPath);

  try {
    // Write WORKFLOW.md
    if (!existsSync(targetPath)) {
      mkdirSync(targetPath, { recursive: true });
    }
    writeFileSync(outputPath, workflowContent);

    // Write credentials to settings.json
    if (result.credentials) {
      await writeGlobalSettings(result.credentials, result.tracker, prompts, homeDir);
    }

    // Success — clean up backups
    cleanupBackup(workflowBackup);
    cleanupBackup(settingsBackup);
    return true;
  } catch (err) {
    // Restore backups on failure
    if (workflowBackup) restoreBackup(workflowBackup, outputPath);
    if (settingsBackup) restoreBackup(settingsBackup, settingsPath);
    prompts.log.error(
      `Failed to write configuration: ${err instanceof Error ? err.message : String(err)}`,
    );
    prompts.log.info("Previous files have been restored from backup.");
    return false;
  }
}

// --- Main command ---

export async function initCommand(
  args: string[],
  deps: InitDeps,
): Promise<void> {
  const p = deps.prompts;
  const initArgs = parseArgs(args);
  const targetPath =
    args.find((a) => !a.startsWith("-")) ||
    symphonyHome(deps.homedir());

  // Non-interactive mode
  if (initArgs.nonInteractive) {
    const result = nonInteractiveInit(initArgs);
    if (!result.ok) {
      console.error("Non-interactive setup failed:");
      for (const err of result.errors) {
        console.error(`  - ${err}`);
      }
      process.exit(1);
    }

    // --dry-run: print config and exit without writing
    if (initArgs.dryRun) {
      const workflowContent = buildWorkflowYaml(result.result!);
      console.log("=== Dry Run: Configuration Preview ===");
      console.log(workflowContent);
      console.log("=== No files were written. ===");
      return;
    }

    // --export: save config to a JSON file
    if (initArgs.exportPath) {
      const exportData = wizardResultToExportData(result.result!);
      writeExportFile(exportData, initArgs.exportPath);
      console.log(`Config exported to ${resolve(initArgs.exportPath)}`);
      return;
    }

    const workflowContent = buildWorkflowYaml(result.result!);
    const success = await writeConfigWithRecovery(
      targetPath,
      workflowContent,
      result.result!,
      p,
      deps.homedir(),
    );

    if (success) {
      console.log(`WORKFLOW.md written to ${resolve(targetPath, "WORKFLOW.md")}`);
    } else {
      process.exit(1);
    }
    return;
  }

  // Interactive mode
  console.log("");
  p.intro("🎼 Symphony 配置向导");
  p.note(
    "本向导将引导你完成以下配置：\n\n" +
      "  1. 飞书应用凭据 — 连接飞书多维表格作为任务追踪器\n" +
      "  2. Agent 策略 — 控制 AI 的执行权限\n" +
      "  3. 工作区 — 指定 Agent 的工作目录\n" +
      "  4. Prompt 模板 — 定义 Agent 的初始指令\n\n" +
      "配置完成后将生成 WORKFLOW.md 文件。",
    "欢迎使用 Symphony",
  );

  // Check existing WORKFLOW.md
  if (!(await checkExistingWorkflow(deps, targetPath))) {
    return;
  }

  // Step 1: Tracker
  const trackerResult = await stepTracker(deps, initArgs);
  if (!trackerResult) {
    p.outro("Setup cancelled.");
    return;
  }

  // Step 2: Agent
  const agentConfig = await stepAgent(deps, initArgs);
  if (!agentConfig) {
    p.outro("Setup cancelled.");
    return;
  }

  // Step 3: Workspace
  const workspaceConfig = await stepWorkspace(deps, initArgs);
  if (!workspaceConfig) {
    p.outro("Setup cancelled.");
    return;
  }

  // Step 4: Prompt template
  const promptTemplate = await stepTemplate(deps, initArgs);
  if (!promptTemplate) {
    p.outro("Setup cancelled.");
    return;
  }

  const result: WizardResult = {
    tracker: trackerResult.config,
    workspace: workspaceConfig,
    agent: agentConfig,
    promptTemplate,
    credentials: trackerResult.credentials,
  };

  // Validate the assembled result
  const validationErrors = validateWizardResult(result);
  if (validationErrors.length > 0) {
    p.log.error("Configuration validation failed:");
    for (const err of validationErrors) {
      p.log.error(`  - ${err}`);
    }
    p.outro("Setup failed. Please fix the errors above and try again.");
    return;
  }

  const workflowContent = buildWorkflowYaml(result);

  // --dry-run: print config and exit without writing
  if (initArgs.dryRun) {
    p.note(workflowContent, "Dry Run: Configuration Preview");
    p.outro("No files were written.");
    return;
  }

  // --export: save config to a JSON file
  if (initArgs.exportPath) {
    const exportData = wizardResultToExportData(result);
    writeExportFile(exportData, initArgs.exportPath);
    p.log.success(`Config exported to ${resolve(initArgs.exportPath)}`);
    p.outro("Export complete.");
    return;
  }

  // Write with error recovery (backup + restore on failure)
  const success = await writeConfigWithRecovery(
    targetPath,
    workflowContent,
    result,
    p,
    deps.homedir(),
  );

  if (!success) {
    p.outro("Setup failed during file write. Previous configuration has been restored.");
    return;
  }

  const outputPath = resolve(targetPath, "WORKFLOW.md");
  const skillPath = generateTrackerSkill(result, deps.homedir());

  const outroLines = [`WORKFLOW.md 已写入 ${outputPath}`];
  if (skillPath) {
    outroLines.push(`Task skill 已生成 ${skillPath}/SKILL.md`);
  }
  outroLines.push("你可以编辑 WORKFLOW.md 来自定义每次启动 agent 时的 prompt");

  p.outro(outroLines.join("\n"));
}
