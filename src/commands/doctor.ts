import * as p from "@clack/prompts";
import { existsSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { registerCommand } from "./index.ts";
import { FeishuAuth } from "../adapters/tracker/feishu-bitable/auth.ts";
import { FeishuBitableSetupApi } from "../adapters/tracker/feishu-bitable/setup-api.ts";
import { FeishuBitableApi } from "../adapters/tracker/feishu-bitable/api.ts";
import { loadWorkflow, resolveWorkflowPath } from "../workflow/loader.ts";
import { buildServiceConfig, validateDispatchConfig } from "../workflow/config.ts";

interface CheckResult {
  name: string;
  pass: boolean;
  message: string;
}

async function checkClaudeCli(): Promise<CheckResult> {
  try {
    const proc = Bun.spawn(["which", "claude"], { stdout: "pipe", stderr: "pipe" });
    const exitCode = await proc.exited;
    if (exitCode === 0) {
      return { name: "Claude CLI", pass: true, message: "Found in PATH" };
    }
    return { name: "Claude CLI", pass: false, message: "Not found. Install from https://docs.anthropic.com/en/docs/claude-code" };
  } catch {
    return { name: "Claude CLI", pass: false, message: "Could not check (spawn error)" };
  }
}

async function checkWorkflowFile(path: string): Promise<{ config: ReturnType<typeof buildServiceConfig>; result: CheckResult } | { config: null; result: CheckResult }> {
  const filePath = resolveWorkflowPath(path);
  if (!existsSync(filePath)) {
    return { config: null, result: { name: "WORKFLOW.md", pass: false, message: `Not found at ${filePath}. Run 'symphony init' to create one.` } };
  }

  try {
    const workflow = loadWorkflow(filePath);
    const workflowDir = filePath.substring(0, filePath.lastIndexOf("/"));
    const config = buildServiceConfig(workflow.config, workflowDir);
    return { config, result: { name: "WORKFLOW.md", pass: true, message: "Parsed and loaded successfully" } };
  } catch (err) {
    return { config: null, result: { name: "WORKFLOW.md", pass: false, message: `Parse error: ${err instanceof Error ? err.message : String(err)}` } };
  }
}

function checkConfigValidation(config: ReturnType<typeof buildServiceConfig>): CheckResult {
  const error = validateDispatchConfig(config);
  if (error) {
    return { name: "Config validation", pass: false, message: error };
  }
  return { name: "Config validation", pass: true, message: "All required fields present" };
}

async function checkFeishuAuth(config: ReturnType<typeof buildServiceConfig>): Promise<CheckResult> {
  if (config.tracker.kind !== "feishu_bitable") {
    return { name: "Feishu auth", pass: true, message: "Skipped (not feishu_bitable)" };
  }
  if (!config.tracker.app_id || !config.tracker.app_secret) {
    return { name: "Feishu auth", pass: false, message: "Missing app_id or app_secret" };
  }
  try {
    const auth = new FeishuAuth(config.tracker.app_id, config.tracker.app_secret);
    const setupApi = new FeishuBitableSetupApi(auth);
    await setupApi.testConnection();
    return { name: "Feishu auth", pass: true, message: "Credentials valid" };
  } catch (err) {
    return { name: "Feishu auth", pass: false, message: `${err instanceof Error ? err.message : String(err)}` };
  }
}

async function checkBitableAccess(config: ReturnType<typeof buildServiceConfig>): Promise<CheckResult> {
  if (config.tracker.kind !== "feishu_bitable") {
    return { name: "Bitable access", pass: true, message: "Skipped (not feishu_bitable)" };
  }
  if (!config.tracker.app_id || !config.tracker.app_secret || !config.tracker.app_token || !config.tracker.table_id) {
    return { name: "Bitable access", pass: false, message: "Missing app_token or table_id" };
  }
  try {
    const auth = new FeishuAuth(config.tracker.app_id, config.tracker.app_secret);
    const api = new FeishuBitableApi(auth, config.tracker.app_token, config.tracker.table_id);
    await api.listRecords(1);
    return { name: "Bitable access", pass: true, message: "Table accessible" };
  } catch (err) {
    return { name: "Bitable access", pass: false, message: `${err instanceof Error ? err.message : String(err)}` };
  }
}

function checkWorkspaceWritable(config: ReturnType<typeof buildServiceConfig>): CheckResult {
  const root = config.workspace.root;
  try {
    if (!existsSync(root)) {
      mkdirSync(root, { recursive: true });
    }
    // Test write
    const testFile = resolve(root, ".doctor-test");
    writeFileSync(testFile, "test");
    unlinkSync(testFile);
    return { name: "Workspace writable", pass: true, message: root };
  } catch {
    return { name: "Workspace writable", pass: false, message: `Cannot write to ${root}` };
  }
}

async function checkGit(config: ReturnType<typeof buildServiceConfig>): Promise<CheckResult> {
  const sources = config.workspace.sources ?? [];
  const needsGit = sources.some((s) => s.type === "git-clone" || s.type === "git-worktree");
  if (!needsGit) {
    return { name: "Git", pass: true, message: "Skipped (no git sources)" };
  }
  try {
    const proc = Bun.spawn(["which", "git"], { stdout: "pipe", stderr: "pipe" });
    const exitCode = await proc.exited;
    if (exitCode === 0) {
      return { name: "Git", pass: true, message: "Found in PATH" };
    }
    return { name: "Git", pass: false, message: "Not found (required for git-clone/git-worktree sources)" };
  } catch {
    return { name: "Git", pass: false, message: "Could not check" };
  }
}

async function doctorCommand(args: string[]): Promise<void> {
  const path = args.find((a) => !a.startsWith("-")) || process.cwd();

  console.log("");
  p.intro("Symphony Doctor");

  const results: CheckResult[] = [];

  // Check 1: Claude CLI
  const claudeCheck = await checkClaudeCli();
  results.push(claudeCheck);
  claudeCheck.pass ? p.log.success(`${claudeCheck.name}: ${claudeCheck.message}`) : p.log.error(`${claudeCheck.name}: ${claudeCheck.message}`);

  // Check 2: WORKFLOW.md
  const workflowCheck = await checkWorkflowFile(path);
  results.push(workflowCheck.result);
  workflowCheck.result.pass ? p.log.success(`${workflowCheck.result.name}: ${workflowCheck.result.message}`) : p.log.error(`${workflowCheck.result.name}: ${workflowCheck.result.message}`);

  if (workflowCheck.config) {
    const config = workflowCheck.config;

    // Check 3: Config validation
    const validationCheck = checkConfigValidation(config);
    results.push(validationCheck);
    validationCheck.pass ? p.log.success(`${validationCheck.name}: ${validationCheck.message}`) : p.log.error(`${validationCheck.name}: ${validationCheck.message}`);

    // Check 4: Feishu auth
    const feishuCheck = await checkFeishuAuth(config);
    results.push(feishuCheck);
    feishuCheck.pass ? p.log.success(`${feishuCheck.name}: ${feishuCheck.message}`) : p.log.error(`${feishuCheck.name}: ${feishuCheck.message}`);

    // Check 5: Bitable access
    const bitableCheck = await checkBitableAccess(config);
    results.push(bitableCheck);
    bitableCheck.pass ? p.log.success(`${bitableCheck.name}: ${bitableCheck.message}`) : p.log.error(`${bitableCheck.name}: ${bitableCheck.message}`);

    // Check 6: Workspace writable
    const workspaceCheck = checkWorkspaceWritable(config);
    results.push(workspaceCheck);
    workspaceCheck.pass ? p.log.success(`${workspaceCheck.name}: ${workspaceCheck.message}`) : p.log.error(`${workspaceCheck.name}: ${workspaceCheck.message}`);

    // Check 7: Git
    const gitCheck = await checkGit(config);
    results.push(gitCheck);
    gitCheck.pass ? p.log.success(`${gitCheck.name}: ${gitCheck.message}`) : p.log.error(`${gitCheck.name}: ${gitCheck.message}`);
  }

  // Summary
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  const total = results.length;

  if (failed === 0) {
    p.outro(`All ${total} checks passed`);
  } else {
    p.outro(`${passed}/${total} passed, ${failed} failed`);
    process.exit(1);
  }
}

registerCommand("doctor", doctorCommand);
