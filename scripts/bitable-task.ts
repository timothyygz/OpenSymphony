#!/usr/bin/env bun
//
// Feishu Bitable task management CLI
//
// Usage:
//   bun scripts/bitable-task.ts <command> [options]
//
// Commands:
//   list                          List candidate (active) issues
//   all                           List all issues across states
//   show <id>                     Show issue details (record_id or identifier)
//   state <id> <new_state>        Update issue state
//   create <title> [flags]        Create a new task
//
// Global:
//   --workflow <path>             Path to WORKFLOW.md (default: ./WORKFLOW.md)
//
// Create flags:
//   --identifier <text>           Issue identifier (e.g. "SYM-001")
//   --desc <text>                 Description
//   --priority <number>           Priority
//   --labels <a,b,c>             Labels (comma-separated)
//   --initial-state <state>       Initial state (default: first active state)

import { loadWorkflow, resolveWorkflowPath } from "../src/workflow/loader.ts";
import { resolveEnvValue } from "../src/workflow/config.ts";
import { createFeishuBitableAdapter, FeishuBitableAdapter } from "../src/adapters/tracker/feishu-bitable/adapter.ts";
import { FeishuAuth } from "../src/adapters/tracker/feishu-bitable/auth.ts";
import { FeishuBitableApi } from "../src/adapters/tracker/feishu-bitable/api.ts";
import { mapRecordToIssue, type FieldMapping } from "../src/adapters/tracker/feishu-bitable/mapper.ts";
import type { TrackerAdapter } from "../src/adapters/tracker/types.ts";
import type { Issue } from "../src/model/issue.ts";

const FEISHU_BASE = "https://open.feishu.cn";

// --- Arg parsing ---

function parseCli(args: string[]) {
  const options: Record<string, string> = {};
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const value = args[i + 1];
      if (value && !value.startsWith("--")) {
        options[key] = value;
        i++;
      }
    } else {
      positionals.push(args[i]);
    }
  }

  return { options, positionals };
}

// --- Config ---

interface TrackerConfig {
  app_id: string;
  app_secret: string;
  app_token: string;
  table_id: string;
  state_field: string;
  identifier_field: string;
  title_field: string;
  description_field: string;
  priority_field?: string;
  labels_field?: string;
  tokens_field?: string;
  active_states: string[];
  terminal_states: string[];
}

function loadConfig(workflowPath?: string): {
  config: TrackerConfig;
  adapter: TrackerAdapter;
  listAllIssues: () => Promise<Issue[]>;
} {
  const path = resolveWorkflowPath(workflowPath);
  const { config: raw } = loadWorkflow(path);
  const tracker = { ...(raw.tracker as Record<string, unknown>) };

  if (!tracker || tracker.kind !== "feishu_bitable") {
    console.error("Error: tracker.kind must be 'feishu_bitable'");
    process.exit(1);
  }

  tracker.app_id = resolveEnvValue(tracker.app_id) as string;
  tracker.app_secret = resolveEnvValue(tracker.app_secret) as string;

  for (const key of ["app_id", "app_secret", "app_token", "table_id", "state_field", "identifier_field", "title_field"]) {
    if (!tracker[key]) {
      console.error(`Error: tracker.${key} is required`);
      process.exit(1);
    }
  }

  const config = tracker as unknown as TrackerConfig;
  const adapter = createFeishuBitableAdapter(tracker);
  const fieldMapping: FieldMapping = {
    stateField: config.state_field,
    identifierField: config.identifier_field,
    titleField: config.title_field,
    descriptionField: config.description_field,
    priorityField: config.priority_field,
    labelsField: config.labels_field,
  };
  const auth = new FeishuAuth(config.app_id, config.app_secret);
  const api = new FeishuBitableApi(auth, config.app_token, config.table_id);

  const listAllIssues = async () => {
    const records = await api.listRecords();
    return records.map((r) => mapRecordToIssue(r, fieldMapping));
  };

  return { config, adapter, listAllIssues };
}

// --- Output formatting ---

function formatRow(issue: Issue) {
  return {
    identifier: issue.identifier,
    title: issue.title.length > 40 ? issue.title.slice(0, 37) + "..." : issue.title,
    state: issue.state,
    priority: issue.priority ?? "-",
    labels: issue.labels.join(",") || "-",
  };
}

function printDetail(issue: Issue) {
  console.log(`  ID:          ${issue.id}`);
  console.log(`  Identifier:  ${issue.identifier}`);
  console.log(`  Title:       ${issue.title}`);
  console.log(`  State:       ${issue.state}`);
  console.log(`  Priority:    ${issue.priority ?? "-"}`);
  console.log(`  Labels:      ${issue.labels.join(", ") || "-"}`);
  console.log(`  Description: ${issue.description ?? "(none)"}`);
  console.log(`  Created:     ${issue.createdAt?.toISOString() ?? "-"}`);
  console.log(`  Updated:     ${issue.updatedAt?.toISOString() ?? "-"}`);
}

// --- Create record (not in TrackerAdapter) ---

async function createRecord(
  auth: FeishuAuth,
  appToken: string,
  tableId: string,
  fields: Record<string, unknown>,
) {
  const token = await auth.getAccessToken();
  const url = `${FEISHU_BASE}/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });

  if (!resp.ok) {
    throw new Error(`Feishu API error: HTTP ${resp.status} ${await resp.text()}`);
  }

  const data = (await resp.json()) as {
    code: number;
    msg: string;
    data: { record: { record_id: string; fields: Record<string, unknown> } };
  };
  if (data.code !== 0) {
    throw new Error(`Feishu API error: code=${data.code} msg=${data.msg}`);
  }

  return data.data.record;
}

// --- Commands ---

async function cmdList(adapter: TrackerAdapter) {
  const issues = await adapter.fetchCandidateIssues();
  if (issues.length === 0) {
    console.log("No candidate issues found.");
    return;
  }
  console.log(`Found ${issues.length} candidate issue(s):\n`);
  console.table(issues.map(formatRow));
}

async function cmdAll(listAllIssues: () => Promise<Issue[]>) {
  const issues = await listAllIssues();
  if (issues.length === 0) {
    console.log("No issues found.");
    return;
  }
  console.log(`Found ${issues.length} issue(s):\n`);
  console.table(issues.map(formatRow));
}

async function cmdShow(listAllIssues: () => Promise<Issue[]>, id: string) {
  const issues = await listAllIssues();
  const issue = issues.find(
    (i) => i.id === id || i.identifier.toLowerCase() === id.toLowerCase(),
  );
  if (!issue) {
    console.error(`Issue not found: ${id}`);
    process.exit(1);
  }
  printDetail(issue);
}

async function cmdState(adapter: TrackerAdapter, id: string, state: string) {
  await adapter.updateIssueState(id, state);
  console.log(`Updated issue ${id} state -> "${state}"`);
}

async function cmdCreate(
  config: TrackerConfig,
  title: string,
  opts: {
    identifier?: string;
    desc?: string;
    priority?: number;
    labels?: string[];
    state?: string;
  },
) {
  const auth = new FeishuAuth(config.app_id, config.app_secret);
  const fields: Record<string, unknown> = {
    [config.title_field]: title,
  };

  if (opts.identifier) fields[config.identifier_field] = opts.identifier;
  if (opts.desc && config.description_field) fields[config.description_field] = opts.desc;
  if (opts.priority !== undefined && config.priority_field) fields[config.priority_field] = opts.priority;
  if (opts.labels?.length && config.labels_field) fields[config.labels_field] = opts.labels;

  fields[config.state_field] = opts.state ?? config.active_states[0] ?? "待处理";

  const record = await createRecord(auth, config.app_token, config.table_id, fields);
  console.log(`Created issue: ${record.record_id}`);
}

// --- Main ---

function printHelp() {
  console.log(`Usage: bun scripts/bitable-task.ts <command> [options]

Commands:
  list                          List candidate (active) issues
  all                           List all issues
  show <id>                     Show issue details (record_id or identifier)
  state <id> <new_state>        Update issue state
  create <title> [flags]        Create a new task

Global:
  --workflow <path>             Path to WORKFLOW.md (default: ./WORKFLOW.md)

Create flags:
  --identifier <text>           Issue identifier
  --desc <text>                 Description
  --priority <number>           Priority
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
  const { config, adapter, listAllIssues } = loadConfig(options.workflow);

  switch (command) {
    case "list":
      await cmdList(adapter);
      break;

    case "all":
      await cmdAll(listAllIssues);
      break;

    case "show": {
      const id = positionals[0];
      if (!id) {
        console.error("Error: show requires <id>");
        process.exit(1);
      }
      await cmdShow(listAllIssues, id);
      break;
    }

    case "state": {
      const id = positionals[0];
      const state = positionals[1];
      if (!id || !state) {
        console.error("Error: state requires <id> <new_state>");
        process.exit(1);
      }
      await cmdState(adapter, id, state);
      break;
    }

    case "create": {
      const title = positionals[0];
      if (!title) {
        console.error("Error: create requires <title>");
        process.exit(1);
      }
      await cmdCreate(config, title, {
        identifier: options.identifier,
        desc: options.desc,
        priority: options.priority ? parseInt(options.priority, 10) : undefined,
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
