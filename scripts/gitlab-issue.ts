#!/usr/bin/env bun
//
// GitLab Issues task management CLI
//
// Usage:
//   bun scripts/gitlab-issue.ts <command> [options]
//
// Commands:
//   list                          List candidate (active) issues
//   all                           List all issues
//   show <iid>                    Show issue details
//   state <iid> <new_state>       Update issue state
//   create <title> [flags]        Create a new task
//
// Global:
//   --workflow <path>             Path to WORKFLOW.md (default: ./WORKFLOW.md)
//
// Create flags:
//   --desc <text>                 Description
//   --labels <a,b,c>             Labels (comma-separated)
//   --initial-state <state>       Initial state (default: first active state)

import { loadWorkflow, resolveWorkflowPath } from "../src/workflow/loader.ts";
import { resolveEnvValue } from "../src/workflow/config.ts";
import { GitLabApi, type GitLabIssueResponse } from "../src/adapters/tracker/gitlab-issues/api.ts";
import { mapGitLabIssueToIssue, extractSymphonyState, extractNonSymphonyLabels } from "../src/adapters/tracker/gitlab-issues/mapper.ts";
import type { Issue } from "../src/model/issue.ts";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { symphonySettings } from "../src/paths.ts";

const SYMPHONY_LABEL_PREFIX = "symphony::";

// --- Arg parsing ---

function parseCli(args: string[]) {
  const options: Record<string, string> = {};
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = args[i + 1];
      if (value && !value.startsWith("--")) {
        options[key] = value;
        i++;
      }
    } else {
      positionals.push(arg);
    }
  }

  return { options, positionals };
}

// --- Config ---

interface TrackerConfig {
  gitlab_host: string;
  gitlab_token: string;
  project_id: string;
  label_prefix: string;
  active_states: string[];
  terminal_states: string[];
}

function loadConfig(workflowPath?: string): {
  config: TrackerConfig;
  api: GitLabApi;
} {
  const path = resolveWorkflowPath(workflowPath);
  const { config: raw } = loadWorkflow(path);
  const tracker = { ...(raw.tracker as Record<string, unknown>) };

  if (!tracker || tracker.kind !== "gitlab_issues") {
    console.error("Error: tracker.kind must be 'gitlab_issues'");
    process.exit(1);
  }

  // Resolve token: WORKFLOW.md → settings.json → env var
  let token = resolveEnvValue(tracker.gitlab_token) as string;
  if (!token) {
    const settingsPath = symphonySettings();
    if (existsSync(settingsPath)) {
      const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
      token = settings?.tracker?.gitlab_issues?.gitlab_token;
    }
  }
  if (!token) {
    token = process.env.GITLAB_TOKEN;
  }

  const host = (tracker.gitlab_host as string) ?? "https://gitlab.com";
  const projectId = String(tracker.project_id);

  if (!token) {
    console.error("Error: gitlab_token is required (set in WORKFLOW.md, ~/.open-symphony/settings.json, or $GITLAB_TOKEN)");
    process.exit(1);
  }
  if (!projectId) {
    console.error("Error: tracker.project_id is required");
    process.exit(1);
  }

  const config: TrackerConfig = {
    gitlab_host: host,
    gitlab_token: token,
    project_id: projectId,
    label_prefix: (tracker.label_prefix as string) ?? SYMPHONY_LABEL_PREFIX,
    active_states: (tracker.active_states as string[]) ?? ["Todo", "In Progress"],
    terminal_states: (tracker.terminal_states as string[]) ?? ["Done", "Cancelled"],
  };

  const api = new GitLabApi({ host, token, projectId });

  return { config, api };
}

// --- Output formatting ---

function formatRow(issue: Issue) {
  return {
    iid: issue.id,
    identifier: issue.identifier,
    title: issue.title.length > 40 ? issue.title.slice(0, 37) + "..." : issue.title,
    state: issue.state,
    labels: issue.labels.join(",") || "-",
  };
}

function printDetail(issue: Issue, raw: GitLabIssueResponse) {
  console.log(`  IID:         ${issue.id}`);
  console.log(`  Identifier:  ${issue.identifier}`);
  console.log(`  Title:       ${issue.title}`);
  console.log(`  State:       ${issue.state} (GitLab: ${raw.state})`);
  console.log(`  Labels:      ${raw.labels.join(", ") || "-"}`);
  console.log(`  Weight:      ${raw.weight ?? "-"}`);
  console.log(`  Description: ${issue.description ?? "(none)"}`);
  console.log(`  URL:         ${issue.url ?? "-"}`);
  console.log(`  Created:     ${issue.createdAt?.toISOString() ?? "-"}`);
  console.log(`  Updated:     ${issue.updatedAt?.toISOString() ?? "-"}`);
}

// --- Commands ---

async function cmdList(config: TrackerConfig, api: GitLabApi) {
  const labelPrefix = config.label_prefix;
  const seen = new Set<number>();
  const issues: Issue[] = [];

  for (const state of config.active_states) {
    const label = `${labelPrefix}${state}`;
    const raw = await api.listIssues({ labels: label, state: "opened", per_page: "100" });
    for (const r of raw) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        issues.push(mapGitLabIssueToIssue(r));
      }
    }
  }

  if (issues.length === 0) {
    console.log("No candidate issues found.");
    return;
  }
  console.log(`Found ${issues.length} candidate issue(s):\n`);
  console.table(issues.map(formatRow));
}

async function cmdAll(config: TrackerConfig, api: GitLabApi) {
  const raw = await api.listIssues({ state: "opened", per_page: "100" });
  const issues = raw.map(mapGitLabIssueToIssue);

  if (issues.length === 0) {
    console.log("No issues found.");
    return;
  }
  console.log(`Found ${issues.length} issue(s):\n`);
  console.table(issues.map(formatRow));
}

async function cmdShow(api: GitLabApi, iid: string) {
  const raw = await api.getIssue(Number(iid));
  const issue = mapGitLabIssueToIssue(raw);
  printDetail(issue, raw);
}

async function cmdState(config: TrackerConfig, api: GitLabApi, iid: string, newState: string) {
  const raw = await api.getIssue(Number(iid));
  const nonSymphonyLabels = extractNonSymphonyLabels(raw.labels);
  const newLabel = `${config.label_prefix}${newState}`;
  const labels = [...nonSymphonyLabels, newLabel];

  await api.updateIssue(Number(iid), { labels: labels.join(",") });
  console.log(`Updated issue #${iid} state -> "${newState}"`);
}

async function cmdCreate(
  config: TrackerConfig,
  api: GitLabApi,
  title: string,
  opts: {
    desc?: string;
    labels?: string[];
    state?: string;
  },
) {
  const labels: string[] = [...(opts.labels ?? [])];
  const state = opts.state ?? config.active_states[0] ?? "Todo";
  labels.push(`${config.label_prefix}${state}`);

  const created = await api.createIssue({
    title,
    description: opts.desc ?? "",
    labels: labels.join(","),
  });
  const issue = mapGitLabIssueToIssue(created);
  console.log(`Created issue #${created.iid}: ${issue.url ?? created.web_url}`);
}

// --- Main ---

function printHelp() {
  console.log(`Usage: bun scripts/gitlab-issue.ts <command> [options]

Commands:
  list                          List candidate (active) issues
  all                           List all issues
  show <iid>                    Show issue details
  state <iid> <new_state>       Update issue state
  create <title> [flags]        Create a new task

Global:
  --workflow <path>             Path to WORKFLOW.md (default: ./WORKFLOW.md)

Create flags:
  --desc <text>                 Description
  --labels <a,b,c>             Labels (comma-separated)
  --initial-state <state>       Initial state (default: first active state)`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printHelp();
    process.exit(0);
  }

  const command = args[0];
  const { options, positionals } = parseCli(args.slice(1));
  const { config, api } = loadConfig(options.workflow);

  switch (command) {
    case "list":
      await cmdList(config, api);
      break;

    case "all":
      await cmdAll(config, api);
      break;

    case "show": {
      const iid = positionals[0];
      if (!iid) {
        console.error("Error: show requires <iid>");
        process.exit(1);
      }
      await cmdShow(api, iid);
      break;
    }

    case "state": {
      const iid = positionals[0];
      const state = positionals[1];
      if (!iid || !state) {
        console.error("Error: state requires <iid> <new_state>");
        process.exit(1);
      }
      await cmdState(config, api, iid, state);
      break;
    }

    case "create": {
      const title = positionals[0];
      if (!title) {
        console.error("Error: create requires <title>");
        process.exit(1);
      }
      await cmdCreate(config, api, title, {
        desc: options.desc,
        labels: options.labels?.split(",").map((l) => l.trim()),
        state: options["initial-state"],
      });
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
