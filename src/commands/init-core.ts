import { existsSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { availableTrackerKinds, getTrackerSetup } from "../adapters/tracker/registry.ts";
import type { TrackerSetupContext } from "../adapters/tracker/registry.ts";

// --- Types ---

export interface Prompts {
  group<T extends Record<string, () => Promise<unknown>>>(
    prompts: T,
  ): Promise<Record<string, unknown>>;
  text(opts: {
    message: string;
    placeholder?: string;
    defaultValue?: string;
  }): Promise<unknown>;
  select(opts: {
    message: string;
    options: Array<{ value: unknown; label: string; hint?: string }>;
  }): Promise<unknown>;
  confirm(opts: { message: string; initialValue?: boolean }): Promise<unknown>;
  isCancel(val: unknown): boolean;
  spinner(): { start(msg: string): void; stop(msg: string): void };
  note(content: string, title: string): void;
  intro(msg: string): void;
  outro(msg: string): void;
  log: {
    success(msg: string): void;
    error(msg: string): void;
    warn(msg: string): void;
    info(msg: string): void;
  };
}

export interface SetupApi {
  testConnection(): Promise<void>;
  createApp(
    name: string,
  ): Promise<{ app_token: string; table_id: string; url: string }>;
  createTable(appToken: string, name: string): Promise<{ table_id: string }>;
  deleteTable(appToken: string, tableId: string): Promise<void>;
  lookupUserByMobile(phone: string): Promise<string>;
  transferOwnership(appToken: string, openId: string): Promise<void>;
  listTables(appToken: string): Promise<{ table_id: string; name: string }[]>;
  listFields(
    appToken: string,
    tableId: string,
  ): Promise<{ field_name: string; type: number }[]>;
}

export interface InitDeps {
  prompts: Prompts;
  createSetupApi(appId: string, appSecret: string): SetupApi;
  checkClaudeCli(): Promise<boolean>;
  homedir(): string;
}

export interface WizardResult {
  tracker: Record<string, unknown>;
  workspace: Record<string, unknown>;
  agent: Record<string, unknown>;
  promptTemplate: string;
  credentials?: Record<string, string>;
}

// --- Constants ---

const TEMPLATE_PRESETS = [
  { name: "基础模板 (English)" as const, file: "basic.md" },
  { name: "中文模板 (Chinese)" as const, file: "chinese.md" },
  { name: "空模板 (Empty)" as const, file: "empty.md" },
];

// --- Pure functions ---

export function loadTemplate(file: string): string {
  const templateDir = resolve(import.meta.dir, "templates");
  return readFileSync(resolve(templateDir, file), "utf-8");
}

export function objectToYaml(obj: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (obj === null || obj === undefined) return "";
  if (typeof obj === "string")
    return obj.includes("\n")
      ? `|\n${obj
          .split("\n")
          .map((l) => `${pad}  ${l}`)
          .join("\n")}`
      : obj.includes(":") || obj.includes("#")
        ? `"${obj}"`
        : obj;
  if (typeof obj === "number" || typeof obj === "boolean") return String(obj);
  if (Array.isArray(obj)) {
    if (obj.length === 0) return "[]";
    return obj
      .map((v) => {
        if (typeof v === "object" && v !== null && !Array.isArray(v)) {
          const entries = Object.entries(v as Record<string, unknown>);
          if (entries.length === 0) return `${pad}- {}`;
          const [firstKey, firstVal] = entries[0]!;
          const rest = entries.slice(1);
          let line = `${pad}- ${firstKey}: ${scalarYaml(firstVal)}`;
          for (const [k, val] of rest) {
            line += `\n${pad}  ${k}: ${scalarYaml(val)}`;
          }
          return line;
        }
        return `${pad}- ${scalarYaml(v)}`;
      })
      .join("\n");
  }
  if (typeof obj === "object") {
    const entries = Object.entries(obj as Record<string, unknown>);
    return entries
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => {
        if (v === null) return `${pad}${k}: null`;
        if (typeof v === "object" && v !== null) {
          if (Array.isArray(v) && (v as unknown[]).length === 0)
            return `${pad}${k}: []`;
          const sub = objectToYaml(v, indent + 1);
          return `${pad}${k}:\n${sub}`;
        }
        return `${pad}${k}: ${scalarYaml(v)}`;
      })
      .join("\n");
  }
  return String(obj);
}

export function scalarYaml(v: unknown): string {
  if (typeof v === "string") {
    if (v.startsWith("$")) return `"${v}"`;
    if (v.includes(":") || v.includes("#") || v.includes("'")) return `"${v}"`;
    return v;
  }
  if (v === null || v === undefined) return "null";
  return String(v);
}

export function buildWorkflowYaml(result: WizardResult): string {
  const template = loadTemplate("workflow-config.yaml");
  const workspaceYaml = objectToYaml(result.workspace, 1);
  const trackerYaml = objectToYaml(result.tracker, 1);

  const agentConfig = result.agent as Record<string, unknown>;
  const approvalPolicy = String(
    (agentConfig.config as Record<string, unknown> | undefined)?.approval_policy ?? "auto",
  );

  // Remove the hardcoded tracker block from template and inject generated one
  let yaml = template
    .replace(/^tracker:[\s\S]*?(?=\npolling:)/m, "")
    .replace("{{ workspace }}", workspaceYaml)
    .replace("{{ approval_policy }}", approvalPolicy);

  yaml = `tracker:\n${trackerYaml}\n${yaml}`;

  return `---\n${yaml}\n---\n\n${result.promptTemplate}\n`;
}

// --- URL parsing ---

export function parseBitableUrl(
  url: string,
): { appToken: string; tableId?: string } | null {
  try {
    const u = new URL(url);
    const match = u.pathname.match(/\/base\/([A-Za-z0-9]+)/);
    if (!match) return null;
    const appToken = match[1]!;
    const tableId = u.searchParams.get("table") ?? undefined;
    return { appToken, tableId };
  } catch {
    return null;
  }
}

// --- Step functions ---

export async function checkExistingWorkflow(
  deps: InitDeps,
  targetPath: string,
): Promise<boolean> {
  const filePath = resolve(targetPath, "WORKFLOW.md");
  if (!existsSync(filePath)) return true;

  const action = await deps.prompts.select({
    message: "WORKFLOW.md already exists. What would you like to do?",
    options: [
      { value: "overwrite", label: "Overwrite" },
      { value: "cancel", label: "Cancel" },
    ],
  });

  if (deps.prompts.isCancel(action) || action === "cancel") {
    deps.prompts.outro("Cancelled.");
    return false;
  }
  return true;
}

export async function stepTracker(deps: InitDeps): Promise<{
  config: Record<string, unknown>;
  credentials?: Record<string, string>;
} | null> {
  const p = deps.prompts;

  // Ensure tracker adapters are registered so availableTrackerKinds() works
  await import("../adapters/tracker/feishu-bitable/register.ts");
  await import("../adapters/tracker/gitlab-issues/register.ts");

  const kinds = availableTrackerKinds();
  if (kinds.length === 0) {
    p.log.error("No tracker adapters registered");
    return null;
  }

  // If only one kind available, select it directly
  let selectedKind: string;
  if (kinds.length === 1) {
    selectedKind = kinds[0]!;
    p.log.info(`Using tracker: ${selectedKind}`);
  } else {
    const kind = await p.select({
      message: "选择任务追踪器类型",
      options: kinds.map((k) => ({ value: k, label: k })),
    });
    if (p.isCancel(kind)) return null;
    selectedKind = kind as string;
  }

  const setupFn = getTrackerSetup(selectedKind);
  if (!setupFn) {
    p.log.error(`No setup function for tracker: ${selectedKind}`);
    return null;
  }

  const ctx: TrackerSetupContext = {
    prompts: deps.prompts,
    testOverrides: { createSetupApi: deps.createSetupApi },
  };
  const result = await setupFn(ctx);
  if (!result.config || Object.keys(result.config).length === 0) {
    return null;
  }

  return { config: result.config, credentials: result.credentials };
}

export async function stepAgent(
  deps: InitDeps,
): Promise<Record<string, unknown> | null> {
  const p = deps.prompts;

  const found = await deps.checkClaudeCli();
  if (!found) {
    p.log.warn(
      "Claude CLI not found in PATH. Agent commands will fail until installed.",
    );
  }

  const approvalPolicy = await p.select({
    message: "Agent 审批策略（控制 AI 执行命令时是否需要人工确认）",
    options: [
      { value: "auto", label: "auto（推荐）", hint: "自动执行，无需人工确认" },
      { value: "suggest", label: "suggest", hint: "每次执行前询问你确认" },
    ],
  });
  if (p.isCancel(approvalPolicy)) return null;

  return {
    config: {
      approval_policy: approvalPolicy,
    },
  };
}

export async function stepWorkspace(
  deps: InitDeps,
): Promise<Record<string, unknown> | null> {
  const p = deps.prompts;

  const sourceType = await p.select({
    message: "工作区来源类型（决定每个任务如何获取代码）",
    options: [
      {
        value: "git-worktree",
        label: "Git worktree",
        hint: "从现有仓库创建 worktree，适合本地开发",
      },
      {
        value: "git-clone",
        label: "Git clone",
        hint: "自动 clone 仓库，适合远程/CI 环境",
      },
      { value: "none", label: "无", hint: "不使用代码仓库" },
    ],
  });
  if (p.isCancel(sourceType)) return null;

  const root = "~/.open-symphony/workspace";
  const config: Record<string, unknown> = { root };

  if (sourceType === "none") {
    return config;
  }

  if (sourceType === "git-worktree") {
    const repo = await p.text({
      message: "Git repository path (must be an existing git repo)",
      placeholder: "~/Workspace/my-project",
    });
    if (p.isCancel(repo)) return null;
    const clonePath = await p.text({
      message: "Clone path name in workspace",
      defaultValue: "repo",
    });
    if (p.isCancel(clonePath)) return null;
    config.sources = [
      { type: "git-worktree", repo: repo as string, path: clonePath },
    ];
  } else if (sourceType === "git-clone") {
    const url = await p.text({
      message: "仓库地址（Git remote URL）",
      placeholder: "git@github.com:org/repo.git",
    });
    if (p.isCancel(url)) return null;
    const path = await p.text({
      message: "Clone 后的目录名称（相对于工作区根目录）",
      defaultValue: "repo",
    });
    if (p.isCancel(path)) return null;
    const branch = await p.text({
      message: "分支名（可选，默认使用默认分支）",
      placeholder: "main",
    });
    if (p.isCancel(branch)) return null;
    const source: Record<string, unknown> = {
      type: "git-clone",
      url,
      path,
      depth: 1,
    };
    if (branch) source.branch = branch;
    config.sources = [source];
  }

  return config;
}

export async function stepTemplate(deps: InitDeps): Promise<string | null> {
  const p = deps.prompts;

  const templates = TEMPLATE_PRESETS.map((t) => ({
    value: t.file,
    label: t.name,
    hint: loadTemplate(t.file).split("\n").slice(0, 2).join(" → "),
  }));

  const selected = await p.select({
    message: "选择 Prompt 模板（Agent 每次执行任务时会使用该模板作为初始指令）",
    options: templates,
  });
  if (p.isCancel(selected)) return null;

  const content = loadTemplate(selected as string);
  p.note(
    content.slice(0, 500) + (content.length > 500 ? "\n..." : ""),
    "Template preview",
  );

  return content;
}

export async function writeGlobalSettings(
  credentials: Record<string, string>,
  trackerConfig: Record<string, unknown>,
  prompts: Prompts,
  homeDir: string,
): Promise<void> {
  const settingsDir = resolve(homeDir, ".open-symphony");
  const settingsPath = resolve(settingsDir, "settings.json");

  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
  }

  const kind = trackerConfig.kind as string;
  if (!settings.tracker) settings.tracker = {};
  (settings.tracker as Record<string, Record<string, unknown>>)[kind] = { ...credentials };

  if (!existsSync(settingsDir)) {
    mkdirSync(settingsDir, { recursive: true });
  }
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  prompts.log.success(`Credentials written to ${settingsPath}`);
}

// --- Main command ---

export async function initCommand(
  args: string[],
  deps: InitDeps,
): Promise<void> {
  const p = deps.prompts;
  const targetPath =
    args.find((a) => !a.startsWith("-")) ||
    resolve(deps.homedir(), ".open-symphony");

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
