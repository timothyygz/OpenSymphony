import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, copyFileSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { DIR_NAME, symphonyHome, symphonySettings } from "../paths.ts";
import type { InitDeps, WizardResult } from "./types.ts";
import { buildWorkflowYaml, parseWorkflowFile, TEMPLATE_PRESETS, loadTemplate } from "./yaml.ts";
import type { ParsedWorkflow } from "./yaml.ts";
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

export const TOTAL_STEPS = 2;

export function progressBar(current: number, total: number): string {
  const filled = "█".repeat(current);
  const empty = "░".repeat(Math.max(0, total - current));
  return `[${filled}${empty}] ${current}/${total}`;
}

export function showStep(p: InitDeps["prompts"], step: number, title: string, hint?: string) {
  const content = hint
    ? `${progressBar(step, TOTAL_STEPS)}\n${hint}`
    : `${progressBar(step, TOTAL_STEPS)}`;
  p.note(content, title);
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

  // Check existing WORKFLOW.md
  const existingAction = await checkExistingWorkflow(deps, targetPath);
  if (!existingAction) return;

  // Parse existing config if reconfiguring
  let existingConfig: ParsedWorkflow | null = null;
  if (existingAction === "reconfigure") {
    const filePath = resolve(targetPath, "WORKFLOW.md");
    existingConfig = parseWorkflowFile(readFileSync(filePath, "utf-8"));
    if (existingConfig) {
      const trackerKind = (existingConfig.tracker.kind as string) ?? "unknown";
      const wsSources = (existingConfig.workspace as Record<string, unknown>).sources;
      const wsDesc = wsSources
        ? String((wsSources as Record<string, unknown>[])[0]?.type ?? "configured")
        : "默认工作区";
      const tmplName = TEMPLATE_PRESETS.find((t) =>
        existingConfig!.promptTemplate.includes(loadTemplate(t.file)),
      )?.name ?? existingConfig.promptTemplate.split("\n")[0]?.slice(0, 40) ?? "";
      p.note(
        `追踪器：${trackerKind}\n工作区：${wsDesc}\nPrompt 模板：${tmplName}`,
        "当前配置",
      );
      p.log.info("将重新运行配置向导，你可以修改任意步骤。");
    } else {
      p.log.warn("无法解析现有配置，将从头开始配置。");
    }
  } else {
    p.note(
      "本向导将引导你完成以下配置：\n\n" +
        "  1. 任务追踪器 — 连接飞书多维表格、GitLab Issues 或 GitHub Issues\n" +
        "  2. Prompt 模板 — 定义 Agent 的初始指令\n\n" +
        `配置完成后将生成 WORKFLOW.md 文件。\n` +
        `工作区默认为 ~/${DIR_NAME}/workspace，可在 WORKFLOW.md 中修改。\n` +
        "Agent 审批策略默认为 auto（自动执行），可在 WORKFLOW.md 中修改。",
      "欢迎使用 Symphony",
    );
  }

  // Build step hints from existing config when reconfiguring
  const trackerHint = existingConfig
    ? `当前: ${(existingConfig.tracker.kind as string) ?? "未知"}`
    : undefined;
  const templateHint = existingConfig
    ? `当前: ${TEMPLATE_PRESETS.find((t) => existingConfig!.promptTemplate.includes(loadTemplate(t.file)))?.name ?? "自定义模板"}`
    : undefined;

  // Step 1/2: Tracker
  showStep(p, 1, "任务追踪器", trackerHint);
  const trackerResult = await stepTracker(deps, initArgs);
  if (!trackerResult) {
    p.outro("Setup cancelled.");
    return;
  }

  // Step 2/2: Prompt template
  showStep(p, 2, "Prompt 模板", templateHint);
  const promptTemplate = await stepTemplate(deps, initArgs);
  if (!promptTemplate) {
    p.outro("Setup cancelled.");
    return;
  }

  // Preserve existing workspace config when reconfiguring, otherwise default to "none"
  const workspaceConfig = existingConfig?.workspace?.sources
    ? existingConfig.workspace
    : { root: `~/${DIR_NAME}/workspace` };

  // Agent config uses sensible defaults (approval_policy: auto)
  const agentConfig = { config: { approval_policy: "auto" } };

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

  // Show completion summary with progress bar
  const trackerKind = (result.tracker.kind as string) ?? "unknown";
  const wsSources = (result.workspace as Record<string, unknown>).sources;
  const wsDesc = wsSources
    ? String((wsSources as Record<string, unknown>[])[0]?.type ?? "configured")
    : `默认 (~/${DIR_NAME}/workspace)`;
  const summaryBar = progressBar(TOTAL_STEPS, TOTAL_STEPS);
  p.note(
    `${summaryBar}\n\n追踪器：${trackerKind}\n工作区：${wsDesc}\nPrompt 模板：${(result.promptTemplate.split("\n")[0] ?? "").slice(0, 60)}`,
    "配置完成",
  );

  const outroLines = [`WORKFLOW.md 已写入 ${outputPath}`];
  if (skillPath) {
    outroLines.push(`Task skill 已生成 ${skillPath}/SKILL.md`);
  }
  outroLines.push("你可以编辑 WORKFLOW.md 来自定义 Agent 行为和 Prompt 指令");

  p.outro(outroLines.join("\n"));
}
