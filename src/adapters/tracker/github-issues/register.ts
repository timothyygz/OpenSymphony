import { registerTracker } from "../registry.ts";
import type { TrackerSetupFn } from "../../setup/types.ts";
import { createGitHubIssuesAdapter } from "./adapter.ts";
import { GitHubApi } from "./api.ts";
import { DEFAULT_SYMPHONY_LABELS } from "../label-based/common.ts";

export const githubSetup: TrackerSetupFn = async (ctx) => {
  const p = ctx.prompts;

  p.note(
    "需要 GitHub Personal Access Token 来访问 Issues API。\n\n" +
      "创建方式：GitHub → Settings → Developer settings → Personal access tokens\n" +
      "  - 勾选 repo 权限\n" +
      "  - 建议设置合理的过期时间\n\n" +
      "如果是 GitHub Enterprise，请填写完整的 GitHub 地址。",
    "📋 GitHub 配置",
  );

  const section = await p.group({
    host: () =>
      p.text({
        message: "GitHub 地址",
        placeholder: "https://github.com",
        defaultValue: "https://github.com",
      }),
    token: () =>
      p.text({
        message: "Personal Access Token（需要 repo 权限）",
        placeholder: "ghp_xxxxxxxxxxxx",
      }),
    owner: () =>
      p.text({
        message: "仓库所有者（用户名或组织名）",
        placeholder: "my-org",
      }),
    repo: () =>
      p.text({
        message: "仓库名",
        placeholder: "my-repo",
      }),
  });

  if (p.isCancel(section)) return { config: {} };

  const host = (section.host as string) || "https://github.com";
  const token = section.token as string;
  const owner = section.owner as string;
  const repo = section.repo as string;

  if (!token || !owner || !repo) {
    p.log.error("Token、所有者和仓库名为必填项");
    return { config: {} };
  }

  const api = new GitHubApi({
    host,
    token,
    owner,
    repo,
  });

  // Test connection
  const s = p.spinner();
  s.start("Testing GitHub connection...");
  try {
    const repository = await api.testConnection();
    s.stop(`Connected to: ${repository.name}`);
  } catch (err) {
    s.stop("Connection failed");
    p.log.error(`Connection error: ${err instanceof Error ? err.message : String(err)}`);
    return { config: {} };
  }

  // Offer to create labels
  const createLabels = await p.confirm({
    message: "是否自动创建 symphony:: 状态标签？",
    initialValue: true,
  });
  if (createLabels && !p.isCancel(createLabels)) {
    const ls = p.spinner();
    ls.start("Creating symphony labels...");
    let created = 0;
    for (const label of DEFAULT_SYMPHONY_LABELS) {
      try {
        await api.createLabel(label.name, label.color);
        created++;
      } catch {
        // Label may already exist
      }
    }
    ls.stop(`Created/skipped ${created} labels`);
  }

  // Active/terminal states
  const activeStates = await p.text({
    message: "活跃状态（逗号分隔，对应 symphony:: 标签）",
    defaultValue: "Todo,In Progress",
  });
  if (p.isCancel(activeStates)) return { config: {} };

  const terminalStates = await p.text({
    message: "终态（逗号分隔，对应 symphony:: 标签）",
    defaultValue: "Done,Cancelled",
  });
  if (p.isCancel(terminalStates)) return { config: {} };

  return {
    config: {
      kind: "github_issues",
      github_host: host || "https://github.com",
      owner,
      repo,
      active_states: (activeStates as string).split(",").map((s) => s.trim()),
      terminal_states: (terminalStates as string).split(",").map((s) => s.trim()),
    },
    credentials: {
      github_token: token,
    },
  };
};

function validateGitHubConfig(config: Record<string, unknown>): string | null {
  if (!config.github_host) return "tracker.github_host is required for github_issues";
  if (!config.github_token) return "tracker.github_token is required (set in WORKFLOW.md, ~/.open-symphony/settings.json, or $GITHUB_TOKEN)";
  if (!config.owner) return "tracker.owner is required for github_issues";
  if (!config.repo) return "tracker.repo is required for github_issues";
  return null;
}

registerTracker("github_issues", createGitHubIssuesAdapter, githubSetup, {
  label: "GitHub Issues",
  description: "使用 GitHub Issues 和标签管理任务状态",
  category: "git-hosting",
}, validateGitHubConfig);
