import { existsSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { symphonyHome, symphonySettings, DIR_NAME } from "../paths.ts";
import { availableTrackerKinds, getTrackerSetup } from "../adapters/tracker/registry.ts";
import type { TrackerSetupContext } from "./types.ts";
import type { Prompts, InitDeps } from "./types.ts";
import { loadTemplate, TEMPLATE_PRESETS } from "./yaml.ts";

// --- Step functions ---

export async function checkExistingWorkflow(
  deps: InitDeps,
  targetPath: string,
): Promise<"new" | "reconfigure" | false> {
  const filePath = resolve(targetPath, "WORKFLOW.md");
  if (!existsSync(filePath)) return "new";

  const action = await deps.prompts.select({
    message: "已存在 WORKFLOW.md，如何处理？",
    options: [
      { value: "reconfigure", label: "编辑已有配置", hint: "查看当前配置并重新选择" },
      { value: "overwrite", label: "覆盖已有配置", hint: "从头开始配置向导" },
      { value: "cancel", label: "取消" },
    ],
  });

  if (deps.prompts.isCancel(action) || action === "cancel") {
    deps.prompts.outro("已取消。");
    return false;
  }
  return action as "new" | "reconfigure";
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

export async function stepWorkspace(
  deps: InitDeps,
): Promise<Record<string, unknown> | null> {
  const p = deps.prompts;

  const sourceType = await p.select({
    message: "工作区来源类型（决定每个任务如何获取代码）",
    options: [
      { value: "none", label: "无（推荐）", hint: "不使用代码仓库，适合快速上手" },
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
    ],
  });
  if (p.isCancel(sourceType)) return null;

  const root = `~/${DIR_NAME}/workspace`;
  const config: Record<string, unknown> = { root };

  if (sourceType === "none") {
    return config;
  }

  if (sourceType === "git-worktree") {
    const repo = await p.text({
      message: "Git 仓库路径（必须是已存在的本地仓库）",
      placeholder: "~/Workspace/my-project",
    });
    if (p.isCancel(repo)) return null;
    const clonePath = await p.text({
      message: "工作区中的目录名称",
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

  const templates = TEMPLATE_PRESETS.map((t) => {
    const content = loadTemplate(t.file);
    // Show first meaningful line of template as preview
    const preview = content
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0 && !l.startsWith("{%")) ?? "";
    return {
      value: t.file,
      label: t.name,
      hint: preview.length > 50 ? preview.slice(0, 47) + "..." : preview,
    };
  });

  const selected = await p.select({
    message: "选择 Prompt 模板（Agent 每次执行任务时会使用该模板作为初始指令）",
    options: templates,
  });
  if (p.isCancel(selected)) return null;

  const content = loadTemplate(selected as string);

  // Show a rendered preview with sample data
  const sampleRendered = renderTemplatePreview(content);
  p.note(
    sampleRendered,
    "模板预览（示例渲染效果）",
  );

  return content;
}

/**
 * Render a LiquidJS template with sample data for preview purposes.
 * Uses simple string replacement instead of a full template engine.
 */
export function renderTemplatePreview(template: string): string {
  const sampleData: Record<string, string> = {
    "{{ issue.identifier }}": "TASK-20260508-20",
    "{{ issue.title }}": "优化setup模块",
    "{{ issue.description }}": "持续优化setup模块，改进用户体验...",
    "{{ issue.state }}": "进行中",
    "{{ issue.priority }}": "高",
    '{{ issue.labels | join: ", " }}': "enhancement, UX",
    '{{ issue.labels | join: "、" }}': "enhancement、UX",
    "{{ attempt }}": "2",
  };

  let rendered = template;
  for (const [placeholder, value] of Object.entries(sampleData)) {
    rendered = rendered.replaceAll(placeholder, value);
  }
  // Remove LiquidJS control flow blocks
  rendered = rendered
    .replace(/\{%\s*if\s+.*?\s*%\}\n?/g, "")
    .replace(/\{%\s*endif\s*%\}\n?/g, "");

  return rendered;
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
  prompts.log.success(`凭据已写入 ${settingsPath}`);
}
