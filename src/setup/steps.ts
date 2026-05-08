import { existsSync, writeFileSync, readFileSync, mkdirSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { symphonyHome, symphonySettings, DIR_NAME } from "../paths.ts";
import { availableTrackerKinds, getTrackerSetup, getTrackerMeta } from "../adapters/tracker/registry.ts";
import type { TrackerSetupContext } from "./types.ts";
import type { Prompts, InitDeps } from "./types.ts";
import type { InitArgs } from "./args.ts";
import { loadTemplate, TEMPLATE_PRESETS } from "./yaml.ts";

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
      { value: "backup", label: "Backup and overwrite", hint: "保存旧文件为 WORKFLOW.md.bak 后覆盖" },
      { value: "overwrite", label: "Overwrite" },
      { value: "cancel", label: "Cancel" },
    ],
  });

  if (deps.prompts.isCancel(action) || action === "cancel") {
    deps.prompts.outro("Cancelled.");
    return false;
  }

  if (action === "backup") {
    const backupPath = filePath + ".bak";
    copyFileSync(filePath, backupPath);
    deps.prompts.log.success(`Backup saved to ${backupPath}`);
  }

  return true;
}

export async function stepTracker(deps: InitDeps, initArgs?: InitArgs): Promise<{
  config: Record<string, unknown>;
  credentials?: Record<string, string>;
} | null> {
  const p = deps.prompts;

  // Ensure tracker adapters are registered so availableTrackerKinds() works
  await import("../adapters/tracker/feishu-bitable/register.ts");
  await import("../adapters/tracker/gitlab-issues/register.ts");
  await import("../adapters/tracker/github-issues/register.ts");

  const kinds = availableTrackerKinds();
  if (kinds.length === 0) {
    p.log.error("No tracker adapters registered");
    return null;
  }

  // If only one kind available, select it directly
  let selectedKind: string;
  if (kinds.length === 1) {
    selectedKind = kinds[0]!;
    const meta = getTrackerMeta(selectedKind);
    p.log.info(`Using tracker: ${meta?.label ?? selectedKind}`);
  } else if (initArgs?.tracker) {
    // Pre-selected via CLI args
    selectedKind = initArgs.tracker;
    if (!kinds.includes(selectedKind)) {
      p.log.error(`Unknown tracker: ${selectedKind}. Available: ${kinds.join(", ")}`);
      return null;
    }
    const meta = getTrackerMeta(selectedKind);
    p.log.info(`Using tracker: ${meta?.label ?? selectedKind}`);
  } else {
    // Sort: recommended first, then by category, then alphabetically
    const sorted = [...kinds].sort((a, b) => {
      const ma = getTrackerMeta(a);
      const mb = getTrackerMeta(b);
      // Recommended first
      if (ma?.recommended && !mb?.recommended) return -1;
      if (!ma?.recommended && mb?.recommended) return 1;
      // Then by category
      const catA = ma?.category ?? "zzz";
      const catB = mb?.category ?? "zzz";
      if (catA < catB) return -1;
      if (catA > catB) return 1;
      return 0;
    });

    const kind = await p.select({
      message: "选择任务追踪器类型",
      options: sorted.map((k) => {
        const meta = getTrackerMeta(k);
        const label = meta?.label ?? k;
        const suffix = meta?.recommended ? "（推荐）" : "";
        return {
          value: k,
          label: `${label}${suffix}`,
          hint: meta?.description,
        };
      }),
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
    initArgs,
  };
  const result = await setupFn(ctx);
  if (!result.config || Object.keys(result.config).length === 0) {
    return null;
  }

  return { config: result.config, credentials: result.credentials };
}

export async function stepAgent(
  deps: InitDeps,
  initArgs?: InitArgs,
): Promise<Record<string, unknown> | null> {
  const p = deps.prompts;

  const found = await deps.checkClaudeCli();
  if (!found) {
    p.log.warn(
      "Claude CLI not found in PATH. Agent commands will fail until installed.",
    );
  }

  let approvalPolicy: unknown;
  if (initArgs?.approvalPolicy) {
    approvalPolicy = initArgs.approvalPolicy;
    p.log.info(`Using approval policy: ${approvalPolicy}`);
  } else {
    approvalPolicy = await p.select({
      message: "Agent 审批策略（控制 AI 执行命令时是否需要人工确认）",
      options: [
        { value: "auto", label: "auto（推荐）", hint: "自动执行，无需人工确认" },
        { value: "suggest", label: "suggest", hint: "每次执行前询问你确认" },
      ],
    });
    if (p.isCancel(approvalPolicy)) return null;
  }

  return {
    config: {
      approval_policy: approvalPolicy,
    },
  };
}

export async function stepWorkspace(
  deps: InitDeps,
  initArgs?: InitArgs,
): Promise<Record<string, unknown> | null> {
  const p = deps.prompts;

  let sourceType: unknown;
  if (initArgs?.workspaceType) {
    sourceType = initArgs.workspaceType;
    p.log.info(`Using workspace type: ${sourceType}`);
  } else {
    sourceType = await p.select({
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
  }

  const root = initArgs?.workspaceRoot || `~/${DIR_NAME}/workspace`;
  const config: Record<string, unknown> = { root };

  if (sourceType === "none") {
    return config;
  }

  if (sourceType === "git-worktree") {
    let repo: unknown;
    if (initArgs?.gitRepo) {
      repo = initArgs.gitRepo;
    } else {
      repo = await p.text({
        message: "Git repository path (must be an existing git repo)",
        placeholder: "~/Workspace/my-project",
      });
      if (p.isCancel(repo)) return null;
    }

    let clonePath: unknown;
    if (initArgs?.gitPath) {
      clonePath = initArgs.gitPath;
    } else {
      clonePath = await p.text({
        message: "Clone path name in workspace",
        defaultValue: "repo",
      });
      if (p.isCancel(clonePath)) return null;
    }

    config.sources = [
      { type: "git-worktree", repo: repo as string, path: clonePath },
    ];
  } else if (sourceType === "git-clone") {
    let url: unknown;
    if (initArgs?.gitUrl) {
      url = initArgs.gitUrl;
    } else {
      url = await p.text({
        message: "仓库地址（Git remote URL）",
        placeholder: "git@github.com:org/repo.git",
      });
      if (p.isCancel(url)) return null;
    }

    let path: unknown;
    if (initArgs?.gitPath) {
      path = initArgs.gitPath;
    } else {
      path = await p.text({
        message: "Clone 后的目录名称（相对于工作区根目录）",
        defaultValue: "repo",
      });
      if (p.isCancel(path)) return null;
    }

    let branch: unknown;
    if (initArgs?.gitBranch) {
      branch = initArgs.gitBranch;
    } else {
      branch = await p.text({
        message: "分支名（可选，默认使用默认分支）",
        placeholder: "main",
      });
      if (p.isCancel(branch)) return null;
    }

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

export async function stepTemplate(deps: InitDeps, initArgs?: InitArgs): Promise<string | null> {
  const p = deps.prompts;

  if (initArgs?.template) {
    const preset = TEMPLATE_PRESETS.find(
      (t) => t.file === initArgs.template || t.name === initArgs.template,
    );
    if (preset) {
      const content = loadTemplate(preset.file);
      p.log.info(`Using template: ${preset.name}`);
      return content;
    }
    // Try as a file path
    try {
      const content = Bun.file(initArgs.template).textSync();
      p.log.info(`Using template from: ${initArgs.template}`);
      return content;
    } catch {
      p.log.error(`Cannot read template file: ${initArgs.template}`);
      return null;
    }
  }

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
  const settingsDir = symphonyHome(homeDir);
  const settingsPath = symphonySettings(homeDir);

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
