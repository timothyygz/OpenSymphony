import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { symphonyHome } from "../paths.ts";
import type { InitDeps, WizardResult } from "./types.ts";
import { buildWorkflowYaml } from "./yaml.ts";
import {
  checkExistingWorkflow,
  stepTracker,
  stepAgent,
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
  const trackerResult = await stepTracker(deps);
  if (!trackerResult) {
    p.outro("Setup cancelled.");
    return;
  }

  // Step 2: Agent
  const agentConfig = await stepAgent(deps);
  if (!agentConfig) {
    p.outro("Setup cancelled.");
    return;
  }

  // Step 3: Workspace
  const workspaceConfig = await stepWorkspace(deps);
  if (!workspaceConfig) {
    p.outro("Setup cancelled.");
    return;
  }

  // Step 4: Prompt template
  const promptTemplate = await stepTemplate(deps);
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

  p.outro(
    `WORKFLOW.md 已写入 ${outputPath}\n你可以编辑 WORKFLOW.md 来自定义每次启动 agent 时的 prompt`,
  );
}
