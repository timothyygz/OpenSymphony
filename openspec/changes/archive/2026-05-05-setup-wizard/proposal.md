# Setup Wizard (symphony init)

## Summary

Add an interactive `symphony init` command that guides users through creating a `WORKFLOW.md` configuration file, replacing the current manual copy-edit workflow.

## Motivation

Current onboarding requires users to manually copy `WORKFLOW.md.example`, understand YAML front matter, fill dozens of fields (Feishu credentials, Bitable field mapping, workspace sources, agent config, Liquid template syntax). This is error-prone and has a high learning curve.

The wizard should:
1. Eliminate manual field mapping for Feishu Bitable by auto-creating a compliant table
2. Validate connectivity before writing config (tracker + agent)
3. Produce a ready-to-run `WORKFLOW.md` in under 2 minutes

## Scope

### In scope
- `symphony init` interactive wizard with `@clack/prompts`
- Feishu Bitable tracker: credential input, connection test, auto-create compliant table
- Agent selection: claude-code only, with CLI availability check
- Workspace source: git-worktree / git-clone / none
- Prompt template: preset selection
- Credential storage: offer `~/.open-symphony/settings.json` or inline in WORKFLOW.md
- `symphony doctor` system diagnostic command

### Out of scope
- Linear tracker support (future)
- Multi-config file management (WORKFLOW.dev.md / WORKFLOW.prod.md)
- Non-interactive / `--quick` mode (can add later)
- echo agent（仅用于测试，不暴露给用户）
- 多 workspace source 配置（本版本只支持单个）

## Flow

```
symphony init
│
├─ Welcome + output path selection
│
├─ Step 1: Tracker (Feishu Bitable)
│   ├─ Input: app_id, app_secret
│   ├─ Connection test (spinner)
│   ├─ Auto-create Bitable with standard fields
│   │   └─ Returns app_token + table_id
│   └─ State names (active_states, terminal_states) with defaults
│
├─ Step 2: Agent
│   ├─ Agent kind: claude-code (自动选择)
│   ├─ CLI availability check (`which claude`)
│   └─ Params: max_concurrent, max_turns, approval_policy
│
├─ Step 3: Workspace
│   ├─ Source type: git-worktree / git-clone / none
│   └─ Root directory（单个 source）
│
├─ Step 4: Prompt template
│   └─ Preset selection with preview
│
├─ Step 5: Credential storage preference
│
└─ Step 6: Preview + confirm → write WORKFLOW.md
```

## Success criteria

- [ ] `symphony init` produces a valid WORKFLOW.md that passes `validateDispatchConfig()`
- [ ] Connection test catches invalid Feishu credentials before config is written
- [ ] Auto-created Bitable has all required fields (编号/标题/状态/描述/优先级/标签/tokens消耗/进度/结果摘要/操作命令)
- [ ] 目标路径已有 WORKFLOW.md 时，提示用户选择覆盖或取消
- [ ] `symphony doctor` checks: bun version, claude CLI, WORKFLOW.md validity, Feishu connectivity
