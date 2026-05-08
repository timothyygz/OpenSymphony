import { registerTracker } from "../registry.ts";
import type { TrackerSetupFn } from "../../setup/types.ts";
import { createGitLabIssuesAdapter } from "./adapter.ts";
import { GitLabApi } from "./api.ts";

const SYMPHONY_LABELS = [
  { name: "symphony::Todo", color: "#428BCA" },
  { name: "symphony::In Progress", color: "#F0AD4E" },
  { name: "symphony::Done", color: "#5CB85C" },
  { name: "symphony::Cancelled", color: "#D9534F" },
];

export const gitlabSetup: TrackerSetupFn = async (ctx) => {
  const p = ctx.prompts;

  p.note(
    "需要 GitLab Personal Access Token 来访问 Issues API。\n\n" +
      "创建方式：GitLab → Settings → Access Tokens\n" +
      "  - 勾选 api 权限\n" +
      "  - 建议设置合理的过期时间\n\n" +
      "如果是自托管 GitLab，请填写完整的 GitLab 地址。",
    "📋 GitLab 配置",
  );

  const section = await p.group({
    host: () =>
      p.text({
        message: "GitLab 地址",
        placeholder: "https://gitlab.com",
        defaultValue: "https://gitlab.com",
      }),
    token: () =>
      p.text({
        message: "Personal Access Token（需要 api 权限）",
        placeholder: "glpat-xxxxxxxxxxxx",
      }),
    projectId: () =>
      p.text({
        message: "项目 ID 或路径（如 group/project 或数字 ID）",
        placeholder: "123",
      }),
  });

  if (p.isCancel(section)) return { config: {} };

  const host = (section.host as string) || "https://gitlab.com";
  const token = section.token as string;
  const projectId = String(section.projectId);

  if (!token || !projectId) {
    p.log.error("Token 和项目 ID 为必填项");
    return { config: {} };
  }

  const api = new GitLabApi({ host, token, projectId });

  // Test connection
  const s = p.spinner();
  s.start("Testing GitLab connection...");
  try {
    const project = await api.testConnection();
    s.stop(`Connected to: ${project.name}`);
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
    for (const label of SYMPHONY_LABELS) {
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
      kind: "gitlab_issues",
      gitlab_host: host,
      project_id: projectId,
      active_states: (activeStates as string).split(",").map((s) => s.trim()),
      terminal_states: (terminalStates as string).split(",").map((s) => s.trim()),
    },
    credentials: {
      gitlab_token: token,
    },
  };
};

registerTracker("gitlab_issues", createGitLabIssuesAdapter, gitlabSetup);
