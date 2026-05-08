import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { DIR_NAME, symphonyHome } from "../paths.ts";
import type { InitDeps, WizardResult } from "./types.ts";
import { buildWorkflowYaml, parseWorkflowFile, TEMPLATE_PRESETS, loadTemplate } from "./yaml.ts";
import type { ParsedWorkflow } from "./yaml.ts";
import {
  checkExistingWorkflow,
  stepTracker,
  stepTemplate,
  writeGlobalSettings,
} from "./steps.ts";

export const TOTAL_STEPS = 2;

export function progressBar(current: number, total: number): string {
  const filled = "█".repeat(current);
  const empty = "░".repeat(total - current);
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
  const targetPath =
    args.find((a) => !a.startsWith("-")) ||
    symphonyHome(deps.homedir());

  console.log("");
  p.intro("🎼 Symphony 配置向导");

  // Check Claude CLI availability
  const claudeFound = await deps.checkClaudeCli();
  if (!claudeFound) {
    p.log.warn(
      "未检测到 Claude CLI，Agent 命令将无法执行。请先安装 Claude CLI。",
    );
  }

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
        "  1. 任务追踪器 — 连接飞书多维表格或 GitLab Issues\n" +
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
  const trackerResult = await stepTracker(deps);
  if (!trackerResult) {
    p.outro("配置已取消。");
    return;
  }

  // Step 2/2: Prompt template
  showStep(p, 2, "Prompt 模板", templateHint);
  const promptTemplate = await stepTemplate(deps);
  if (!promptTemplate) {
    p.outro("配置已取消。");
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

  const workflowContent = buildWorkflowYaml(result);

  // Write credentials to settings.json
  if (result.credentials) {
    await writeGlobalSettings(
      result.credentials,
      result.tracker,
      p,
      deps.homedir(),
    );
  }

  // Write WORKFLOW.md
  const outputPath = resolve(targetPath, "WORKFLOW.md");
  if (!existsSync(targetPath)) {
    mkdirSync(targetPath, { recursive: true });
  }
  writeFileSync(outputPath, workflowContent);

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

  p.outro(
    `✅ WORKFLOW.md 已写入 ${outputPath}\n你可以编辑 WORKFLOW.md 来自定义 Agent 行为和 Prompt 指令`,
  );
}
