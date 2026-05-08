import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { WizardResult } from "./types.ts";

const SKILL_NAME = "create-task";
const AGENTS_SKILLS_DIR = ".agents/skills";

function feishuSkillContent(): string {
  return `---
name: ${SKILL_NAME}
description: Manage tasks in the project tracker. 当用户需要创建、查看、管理任务时使用。Triggers on "任务", "task", "issue", "创建任务", "tracker".
---

Manage tasks in the Feishu Bitable tracker. All commands use the workflow config at \`~/.open-symphony/WORKFLOW.md\`.

**Script**: \`bun scripts/bitable-task.ts <command> --workflow ~/.open-symphony/WORKFLOW.md\`

---

## Commands

### List tasks

\`\`\`bash
bun scripts/bitable-task.ts list --workflow ~/.open-symphony/WORKFLOW.md
\`\`\`

Shows all issues in active states.

### Show task detail

\`\`\`bash
bun scripts/bitable-task.ts show <id> --workflow ~/.open-symphony/WORKFLOW.md
\`\`\`

\`<id>\` can be a record_id or an identifier (e.g. \`SYM-001\`).

### Create a task

\`\`\`bash
bun scripts/bitable-task.ts create "<title>" --workflow ~/.open-symphony/WORKFLOW.md [--identifier <text>] [--desc <text>] [--priority <n>] [--labels <a,b,c>] [--initial-state <state>]
\`\`\`

- \`--identifier\` — issue identifier (e.g. \`SYM-042\`)
- \`--desc\` — description text
- \`--priority\` — priority number
- \`--labels\` — comma-separated labels
- \`--initial-state\` — override default initial state (defaults to first \`active_state\`)

### Update task state

\`\`\`bash
bun scripts/bitable-task.ts state <id> <new_state> --workflow ~/.open-symphony/WORKFLOW.md
\`\`\`

---

## Behavior

- Always run commands via the Bash tool
- Ask for title at minimum when creating; infer rest from context
- Present results in readable format
`;
}

function gitlabSkillContent(): string {
  return `---
name: ${SKILL_NAME}
description: Manage tasks in the project tracker. 当用户需要创建、查看、管理任务时使用。Triggers on "任务", "task", "issue", "创建任务", "tracker".
---

Manage tasks in the GitLab Issues tracker. All commands use the workflow config at \`~/.open-symphony/WORKFLOW.md\`.

**Script**: \`bun scripts/gitlab-issue.ts <command> --workflow ~/.open-symphony/WORKFLOW.md\`

---

## Commands

### List tasks

\`\`\`bash
bun scripts/gitlab-issue.ts list --workflow ~/.open-symphony/WORKFLOW.md
\`\`\`

Shows all issues with active symphony labels (e.g. \`symphony::Todo\`, \`symphony::In Progress\`).

### Show task detail

\`\`\`bash
bun scripts/gitlab-issue.ts show <iid> --workflow ~/.open-symphony/WORKFLOW.md
\`\`\`

### Create a task

\`\`\`bash
bun scripts/gitlab-issue.ts create "<title>" --workflow ~/.open-symphony/WORKFLOW.md [--desc <text>] [--labels <a,b,c>] [--initial-state <state>]
\`\`\`

- \`--desc\` — description text
- \`--labels\` — comma-separated labels
- \`--initial-state\` — override default initial state (defaults to first \`active_state\`)

### Update task state

\`\`\`bash
bun scripts/gitlab-issue.ts state <iid> <new_state> --workflow ~/.open-symphony/WORKFLOW.md
\`\`\`

---

## Behavior

- Always run commands via the Bash tool
- Ask for title at minimum when creating; infer rest from context
- Present results in readable format
`;
}

const SKILL_BUILDERS: Record<string, () => string> = {
  feishu_bitable: feishuSkillContent,
  gitlab_issues: gitlabSkillContent,
};

export function generateTrackerSkill(
  result: WizardResult,
  homeDir: string,
): string | null {
  const kind = result.tracker.kind as string;
  const builder = SKILL_BUILDERS[kind];
  if (!builder) return null;

  const content = builder();
  const skillDir = resolve(homeDir, AGENTS_SKILLS_DIR, SKILL_NAME);

  try {
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(resolve(skillDir, "SKILL.md"), content);
    return skillDir;
  } catch (err) {
    console.warn(
      `Warning: failed to write skill to ${skillDir}: ${err instanceof Error ? err.message : err}`,
    );
    return null;
  }
}
