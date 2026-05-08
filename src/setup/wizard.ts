import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { symphonyHome } from "../paths.ts";
import type { InitDeps, WizardResult } from "./types.ts";
import { buildWorkflowYaml } from "./yaml.ts";
import { generateTrackerSkill } from "./skill-generator.ts";
import {
  checkExistingWorkflow,
  stepTracker,
  stepWorkspace,
  stepTemplate,
  writeGlobalSettings,
} from "./steps.ts";

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
  p.note(
    "本向导将引导你完成以下配置：\n\n" +
      "  1. 任务追踪器 — 连接飞书多维表格或 GitLab Issues\n" +
      "  2. 工作区 — 指定 Agent 的工作目录\n" +
      "  3. Prompt 模板 — 定义 Agent 的初始指令\n\n" +
      "配置完成后将生成 WORKFLOW.md 文件。\n" +
      "Agent 审批策略默认为 auto（自动执行），可在 WORKFLOW.md 中修改。",
    "欢迎使用 Symphony",
  );

  // Check Claude CLI availability
  const claudeFound = await deps.checkClaudeCli();
  if (!claudeFound) {
    p.log.warn(
      "未检测到 Claude CLI，Agent 命令将无法执行。请先安装 Claude CLI。",
    );
  }

  // Check existing WORKFLOW.md
  if (!(await checkExistingWorkflow(deps, targetPath))) {
    return;
  }

  // Step 1/3: Tracker
  p.note("步骤 1/3", "任务追踪器");
  const trackerResult = await stepTracker(deps);
  if (!trackerResult) {
    p.outro("配置已取消。");
    return;
  }

  // Step 2/3: Workspace
  p.note("步骤 2/3", "工作区");
  const workspaceConfig = await stepWorkspace(deps);
  if (!workspaceConfig) {
    p.outro("配置已取消。");
    return;
  }

  // Step 3/3: Prompt template
  p.note("步骤 3/3", "Prompt 模板");
  const promptTemplate = await stepTemplate(deps);
  if (!promptTemplate) {
    p.outro("配置已取消。");
    return;
  }

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

  const skillPath = generateTrackerSkill(result, deps.homedir());

  const outroLines = [`WORKFLOW.md 已写入 ${outputPath}`];
  if (skillPath) {
    outroLines.push(`Task skill 已生成 ${skillPath}/SKILL.md`);
  }
  outroLines.push("你可以编辑 WORKFLOW.md 来自定义每次启动 agent 时的 prompt");

  p.outro(outroLines.join("\n"));
}
