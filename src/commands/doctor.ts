import * as p from "@clack/prompts";
import { existsSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { registerCommand } from "./index.ts";
import { loadWorkflow, resolveWorkflowPath } from "../workflow/loader.ts";
import { buildServiceConfig, validateDispatchConfig } from "../workflow/config.ts";
import { createTracker } from "../adapters/tracker/registry.ts";
import type { HealthCheckResult } from "../adapters/tracker/types.ts";

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
    return { config: null, result: { name: "WORKFLOW.md", pass: false, message: `Not found at ${filePath}. Run 'opensymphony init' to create one.` } };
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

async function checkTrackerHealth(config: ReturnType<typeof buildServiceConfig>): Promise<CheckResult[]> {
  // Ensure adapters are registered
  await import("../adapters/tracker/feishu-bitable/register.ts");
  await import("../adapters/tracker/gitlab-issues/register.ts");

  try {
    const tracker = createTracker(config.tracker.kind, config.tracker as unknown as Record<string, unknown>);

    if (!tracker.healthCheck) {
      return [{ name: "Tracker health", pass: true, message: "Health check skipped (not supported)" }];
    }

    const results: CheckResult[] = [];
    const healthResults: HealthCheckResult[] = await tracker.healthCheck();
    for (const hr of healthResults) {
      results.push({
        name: hr.name,
        pass: hr.status === "pass",
        message: hr.message ?? "",
      });
    }
    return results;
  } catch (err) {
    return [{ name: "Tracker health", pass: false, message: err instanceof Error ? err.message : String(err) }];
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

    // Check 4: Tracker health
    const healthChecks = await checkTrackerHealth(config);
    for (const hc of healthChecks) {
      results.push(hc);
      hc.pass ? p.log.success(`${hc.name}: ${hc.message}`) : p.log.error(`${hc.name}: ${hc.message}`);
    }

    // Check 5: Workspace writable
    const workspaceCheck = checkWorkspaceWritable(config);
    results.push(workspaceCheck);
    workspaceCheck.pass ? p.log.success(`${workspaceCheck.name}: ${workspaceCheck.message}`) : p.log.error(`${workspaceCheck.name}: ${workspaceCheck.message}`);

    // Check 6: Git
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
