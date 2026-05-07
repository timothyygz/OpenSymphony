import { existsSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { STANDARD_FIELDS } from "../adapters/tracker/feishu-bitable/setup-api.ts";

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
  tracker: { app_token: string; table_id: string };
  workspace: Record<string, unknown>;
  agent: { config: { approval_policy: string } };
  promptTemplate: string;
  feishuCredentials?: { app_id: string; app_secret: string };
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

  let yaml = template
    .replace("{{ app_token }}", String(result.tracker.app_token))
    .replace("{{ table_id }}", String(result.tracker.table_id))
    .replace("{{ workspace }}", workspaceYaml)
    .replace(
      "{{ approval_policy }}",
      String((result.agent.config as Record<string, unknown>).approval_policy),
    );

  return `---\n${yaml}\n---\n\n${result.promptTemplate}\n`;
}

// --- URL parsing ---

export function parseBitableUrl(
  url: string,
): { appToken: string; tableId?: string } | null {
  try {
    const u = new URL(url);
    // Match /base/{appToken} in path
    const match = u.pathname.match(/\/base\/([A-Za-z0-9]+)/);
    if (!match) return null;
    const appToken = match[1]!;
    const tableId = u.searchParams.get("table") ?? undefined;
    return { appToken, tableId };
  } catch {
    return null;
  }
}

const REQUIRED_FIELD_NAMES = STANDARD_FIELDS.map((f) => f.field_name);

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
  credentials?: { app_id: string; app_secret: string };
} | null> {
  const p = deps.prompts;

  p.note(
    "需要飞书自建应用的凭据来完成配置。\n\n" +
      "如果你还没有飞书应用，请前往飞书开放平台创建：\n" +
      "  https://open.feishu.cn/app\n\n" +
      "不知道怎么获取？可以问飞书「开放助手」：\n" +
      "  https://open.feishu.cn/app/ai/playground?from=nav&lang=zh-CN\n\n" +
      "凭据在应用的「凭证与基础信息」页面中。",
    "📋 飞书应用配置",
  );

  const section = p.group({
    appId: () =>
      p.text({
        message: "飞书 App ID（在应用「凭证与基础信息」页面获取）",
        placeholder: "cli_xxxxxxxx",
      }),
    appSecret: () =>
      p.text({
        message: "飞书 App Secret（同页面，点击「显示」复制）",
        placeholder: "xxxxxxxxxxxxxxxx",
      }),
  });

  const result = await section;
  if (p.isCancel(result)) return null;

  const setupApi = deps.createSetupApi(
    result.appId as string,
    result.appSecret as string,
  );

  // Test connection
  const s = p.spinner();
  s.start("Testing Feishu connection...");
  try {
    await setupApi.testConnection();
    s.stop("Connection successful");
  } catch (err) {
    s.stop("Connection failed");
    p.log.error(
      `Connection error: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }

  // Choose: create new or use existing
  const mode = await p.select({
    message: "选择多维表格方式",
    options: [
      { value: "new", label: "创建新的多维表格" },
      { value: "existing", label: "使用已有的多维表格" },
    ],
  });
  if (p.isCancel(mode)) return null;

  let appToken: string;
  let tableId: string;

  if (mode === "existing") {
    // --- Use existing Bitable ---
    const urlInput = await p.text({
      message: "请输入飞书多维表格链接",
      placeholder: "https://xxx.feishu.cn/base/xxxxxx",
    });
    if (p.isCancel(urlInput)) return null;

    const parsed = parseBitableUrl(urlInput as string);
    if (!parsed) {
      p.log.error("无法解析多维表格链接，请确认链接格式正确");
      return null;
    }
    appToken = parsed.appToken;

    // Validate access by listing tables
    s.start("正在获取多维表格信息...");
    let tables: { table_id: string; name: string }[];
    try {
      tables = await setupApi.listTables(appToken);
      s.stop(`获取成功，共 ${tables.length} 个工作表`);
    } catch (err) {
      s.stop("获取失败");
      p.log.error(
        `无法访问多维表格: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }

    // If URL has table_id, try to use it directly
    if (parsed.tableId) {
      const target = tables.find((t) => t.table_id === parsed.tableId);
      if (target) {
        // Validate fields
        s.start("正在检查工作表字段...");
        try {
          const fields = await setupApi.listFields(appToken, parsed.tableId);
          s.stop("检查完成");
          const fieldNames = new Set(fields.map((f) => f.field_name));
          const missing = REQUIRED_FIELD_NAMES.filter(
            (n) => !fieldNames.has(n),
          );

          if (missing.length === 0) {
            p.log.success(`工作表「${target.name}」字段校验通过`);
            tableId = parsed.tableId;
            return {
              config: { app_token: appToken, table_id: tableId },
              credentials: {
                app_id: result.appId as string,
                app_secret: result.appSecret as string,
              },
            };
          }
          p.log.warn(`工作表缺少字段: ${missing.join(", ")}`);
          // Fall through to table selection
        } catch {
          s.stop("字段检查失败");
          // Fall through to table selection
        }
      }
    }

    // Let user select a table or create a new one
    const tableOptions = [
      ...tables.map((t) => ({ value: t.table_id, label: t.name })),
      { value: "__create__", label: "创建新工作表（任务）" },
    ];

    const selectedTable = await p.select({
      message: "选择工作表",
      options: tableOptions,
    });
    if (p.isCancel(selectedTable)) return null;

    if (selectedTable === "__create__") {
      s.start("正在创建工作表...");
      try {
        const table = await setupApi.createTable(appToken, "任务");
        tableId = table.table_id;
        s.stop("工作表创建成功");
      } catch (err) {
        s.stop("创建失败");
        p.log.error(`${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    } else {
      // Validate selected table
      tableId = selectedTable as string;
      const target = tables.find((t) => t.table_id === tableId);

      s.start("正在检查工作表字段...");
      try {
        const fields = await setupApi.listFields(appToken, tableId);
        s.stop("检查完成");
        const fieldNames = new Set(fields.map((f) => f.field_name));
        const missing = REQUIRED_FIELD_NAMES.filter((n) => !fieldNames.has(n));

        if (missing.length > 0) {
          p.log.warn(
            `工作表「${target?.name}」缺少字段: ${missing.join(", ")}`,
          );

          const proceed = await p.confirm({
            message: "字段不完整，是否在此多维表格中创建新工作表？",
          });
          if (p.isCancel(proceed) || !proceed) return null;

          s.start("正在创建工作表...");
          try {
            const table = await setupApi.createTable(appToken, "任务");
            tableId = table.table_id;
            s.stop("工作表创建成功");
          } catch (err) {
            s.stop("创建失败");
            p.log.error(`${err instanceof Error ? err.message : String(err)}`);
            return null;
          }
        } else {
          p.log.success(`工作表「${target?.name}」字段校验通过`);
        }
      } catch (err) {
        s.stop("字段检查失败");
        p.log.error(`${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    }

    return {
      config: { app_token: appToken, table_id: tableId },
      credentials: {
        app_id: result.appId as string,
        app_secret: result.appSecret as string,
      },
    };
  }

  // --- Create new Bitable (original flow) ---
  let defaultTableId: string;
  let bitableUrl: string;
  s.start("Creating Bitable app...");
  try {
    const app = await setupApi.createApp("Symphony Tracker");
    appToken = app.app_token;
    defaultTableId = app.table_id;
    bitableUrl = app.url;
    s.stop("Bitable app created");
  } catch (err) {
    s.stop("Failed to create Bitable app");
    p.log.error(`${err instanceof Error ? err.message : String(err)}`);
    return null;
  }

  s.start("Creating standard table...");
  try {
    const table = await setupApi.createTable(appToken, "任务");
    tableId = table.table_id;
    s.stop("Table created");
  } catch (err) {
    s.stop("Failed to create table");
    p.log.error(`${err instanceof Error ? err.message : String(err)}`);
    return null;
  }

  // Delete default empty table
  if (defaultTableId && defaultTableId !== tableId) {
    s.start("Cleaning up default table...");
    try {
      await setupApi.deleteTable(appToken, defaultTableId);
      s.stop("Default table removed");
    } catch {
      s.stop("Could not remove default table (you can delete it manually)");
    }
  }

  p.log.success(`Bitable URL: ${bitableUrl}`);

  // Transfer ownership
  const phone = await p.text({
    message: "请输入你的手机号（用于转让多维表格所有权，可直接回车跳过）",
    placeholder: "13800138000",
  });
  if (!p.isCancel(phone) && (phone as string).trim()) {
    const ts = p.spinner();
    try {
      ts.start("正在查询用户信息...");
      const openId = await setupApi.lookupUserByMobile(
        (phone as string).trim(),
      );
      ts.stop("用户查询成功");

      ts.start("正在转让所有权...");
      await setupApi.transferOwnership(appToken, openId);
      ts.stop("所有权已转让给你，机器人保留管理权限");
    } catch (err) {
      ts.stop("所有权转让失败");
      p.log.warn(
        `转让失败: ${err instanceof Error ? err.message : String(err)}`,
      );
      p.log.info("你可以在飞书中手动添加自己为多维表格协作者");
    }
  } else if (p.isCancel(phone)) {
    // User pressed ctrl+c on this specific prompt — just skip
  } else {
    p.log.info(
      "已跳过所有权转让。你需要在飞书中手动添加自己为多维表格协作者。",
    );
  }

  return {
    config: {
      app_token: appToken,
      table_id: tableId,
    },
    credentials: {
      app_id: result.appId as string,
      app_secret: result.appSecret as string,
    },
  };
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
  credentials: { app_id: string; app_secret: string },
  tracker: { app_token: string; table_id: string },
  prompts: Prompts,
  homeDir: string,
): Promise<void> {
  const settingsDir = resolve(homeDir, ".open-symphony");
  const settingsPath = resolve(settingsDir, "settings.json");

  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
  }

  const feishu: Record<string, string> = {
    app_id: credentials.app_id,
    app_secret: credentials.app_secret,
    app_token: tracker.app_token,
    table_id: tracker.table_id,
  };

  if (!settings.tracker) settings.tracker = {};
  (settings.tracker as Record<string, unknown>).feishu = feishu;

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
    feishuCredentials: trackerResult.credentials,
  };

  const workflowContent = buildWorkflowYaml(result);

  // Write credentials to settings.json
  if (result.feishuCredentials) {
    await writeGlobalSettings(
      result.feishuCredentials,
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
