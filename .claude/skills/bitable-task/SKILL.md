---
name: bitable-task
description: Manage tasks in Feishu Bitable (飞书多维表格). Use when the user wants to list, view, create, or update tasks/issues in the project's Feishu Bitable tracker. Triggers on mentions of "多维表格", "飞书任务", "bitable", "tracker tasks", or task management operations against the Bitable backend.
---

Manage tasks in the Feishu Bitable tracker. All commands read config from `WORKFLOW.md`.

**Script location**: `scripts/bitable-task.ts`

**Run all commands with**: `bun scripts/bitable-task.ts <command> [options]`

---

## Commands

### List candidate issues

```bash
bun scripts/bitable-task.ts list [--workflow <path>]
```

Shows all issues in active states (as configured in `tracker.active_states`). Use this to see what work is available.

### List all issues

```bash
bun scripts/bitable-task.ts all [--workflow <path>]
```

Shows issues across all states (active + terminal). Use when the user wants a full picture.

### Show issue details

```bash
bun scripts/bitable-task.ts show <id> [--workflow <path>]
```

`<id>` can be a record_id or an identifier (e.g. `SYM-001`). Shows full issue details including description.

### Update issue state

```bash
bun scripts/bitable-task.ts state <id> <new_state> [--workflow <path>]
```

Transitions an issue to a new state. Common states: `待处理`, `进行中`, `已完成`, `已取消`, `已关闭`.

### Create a new task

```bash
bun scripts/bitable-task.ts create "<title>" [--identifier <text>] [--desc <text>] [--priority <n>] [--labels <a,b,c>] [--initial-state <state>] [--workflow <path>]
```

Creates a new record in Bitable. Flags:
- `--identifier` — issue identifier (e.g. `SYM-042`)
- `--desc` — description text
- `--priority` — priority number
- `--labels` — comma-separated labels
- `--initial-state` — override the default initial state (defaults to first `active_state`)

---

## When to use

- User asks to see what tasks are pending or available → `list`
- User asks to see all tasks including completed ones → `all`
- User asks about a specific task → `show <id>`
- User wants to move a task to a different state → `state <id> <new_state>`
- User wants to add a new task to the tracker → `create "<title>" [flags]`

## Behavior

- Always run commands via the Bash tool
- Present results in a readable format — reformat table output if needed
- If a command fails due to missing config, explain which fields are needed in `WORKFLOW.md`
- When creating tasks, ask for at minimum a title; infer other fields from context or ask
