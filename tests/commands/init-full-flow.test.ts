import { test, describe, expect, beforeEach, afterEach } from "bun:test";
import { createMockPrompts, CANCEL } from "../__mocks__/clack-prompts.ts";
import { initCommand } from "../../src/setup/wizard.ts";
import type { InitDeps, SetupApi } from "../../src/setup/types.ts";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function createMockSetupApi(overrides: Partial<SetupApi> = {}): SetupApi {
  return {
    testConnection: overrides.testConnection ?? (async () => {}),
    createApp: overrides.createApp ?? (async () => ({
      app_token: "test_app_token",
      table_id: "test_default_table",
      url: "https://feishu.cn/base/test",
    })),
    createTable: overrides.createTable ?? (async () => ({
      table_id: "test_new_table",
    })),
    deleteTable: overrides.deleteTable ?? (async () => {}),
    lookupUserByMobile: overrides.lookupUserByMobile ?? (async () => "ou_test_user"),
    transferOwnership: overrides.transferOwnership ?? (async () => {}),
    listTables: overrides.listTables ?? (async () => []),
    listFields: overrides.listFields ?? (async () => []),
  };
}

function createFlowDeps(tempDir: string, setupApiOverrides: Partial<SetupApi> = {}): {
  deps: InitDeps;
  enqueue: (...values: unknown[]) => void;
} {
  const { prompts, enqueue } = createMockPrompts();
  const deps: InitDeps = {
    prompts,
    createSetupApi: () => createMockSetupApi(setupApiOverrides),
    checkClaudeCli: async () => true,
    homedir: () => tempDir,
  };
  return { deps, enqueue };
}

// Answer sequence for a full happy path:
// checkExistingWorkflow (no file → no prompt)
// stepTracker: tracker kind selection, appId, appSecret (group), phone (empty)
// stepWorkspace: sourceType, root
// stepTemplate: template file
function happyPathAnswers(overrides: Partial<{
  phone: string;
  template: string;
  sourceType: string;
}> = {}): unknown[] {
  const sourceType = overrides.sourceType ?? "none";
  const answers: unknown[] = [
    // stepTracker: tracker kind selection
    "feishu_bitable",
    // stepTracker group: appId, appSecret
    "cli_test_app", "test_secret",
    // mode selection: "new"
    "new",
    // phone (empty = skip transfer)
    overrides.phone ?? "",
    // stepAgent: approval policy
    "auto",
    // stepWorkspace: sourceType
    sourceType,
  ];
  // stepWorkspace: additional prompts based on source type
  if (sourceType === "none") {
    // no more prompts
  } else if (sourceType === "git-worktree") {
    answers.push("~/Workspace/repo", "repo");
  } else if (sourceType === "git-clone") {
    answers.push("git@github.com:org/repo.git", "repo", "main");
  }
  // stepTemplate: template file
  answers.push(overrides.template ?? "basic.md");
  return answers;
}

describe("initCommand full flow", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "symphony-flow-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("happy path — writes WORKFLOW.md and settings.json", async () => {
    const { deps, enqueue } = createFlowDeps(tempDir);
    enqueue(...happyPathAnswers());

    await initCommand([tempDir], deps);

    const workflowPath = join(tempDir, "WORKFLOW.md");
    expect(existsSync(workflowPath)).toBe(true);

    const content = readFileSync(workflowPath, "utf-8");
    // Credentials should NOT be in WORKFLOW.md (always goes to settings.json)
    expect(content).not.toContain("app_id");
    expect(content).not.toContain("app_secret");
    expect(content).toContain("kind: feishu_bitable");
    expect(content).toContain("kind: claude-code");
    expect(content).toContain("identifier");

    // settings.json should contain credentials
    const settingsPath = join(tempDir, ".open-symphony", "settings.json");
    expect(existsSync(settingsPath)).toBe(true);
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    expect(settings.tracker.feishu_bitable.app_id).toBe("cli_test_app");
    expect(settings.tracker.feishu_bitable.app_secret).toBe("test_secret");
  });

  test("cancel at tracker step — no file written", async () => {
    const { deps, enqueue } = createFlowDeps(tempDir);
    enqueue(CANCEL);

    await initCommand([tempDir], deps);

    expect(existsSync(join(tempDir, "WORKFLOW.md"))).toBe(false);
  });

  test("cancel at workspace step — no file written", async () => {
    const { deps, enqueue } = createFlowDeps(tempDir);
    // stepTracker completes, then cancel at workspace step
    enqueue("feishu_bitable", "cli_app", "secret", "new", "", "auto", CANCEL);

    await initCommand([tempDir], deps);

    expect(existsSync(join(tempDir, "WORKFLOW.md"))).toBe(false);
  });

  test("overwrite existing WORKFLOW.md", async () => {
    writeFileSync(join(tempDir, "WORKFLOW.md"), "old content");

    const { deps, enqueue } = createFlowDeps(tempDir);
    // First answer: overwrite for checkExistingWorkflow
    enqueue("overwrite", ...happyPathAnswers());

    await initCommand([tempDir], deps);

    const content = readFileSync(join(tempDir, "WORKFLOW.md"), "utf-8");
    expect(content).toContain("kind: feishu_bitable");
    expect(content).not.toContain("old content");
  });

  test("cancel on existing WORKFLOW.md — original preserved", async () => {
    writeFileSync(join(tempDir, "WORKFLOW.md"), "old content");

    const { deps, enqueue } = createFlowDeps(tempDir);
    enqueue("cancel");

    await initCommand([tempDir], deps);

    const content = readFileSync(join(tempDir, "WORKFLOW.md"), "utf-8");
    expect(content).toBe("old content");
  });

  test("uses custom target path from args", async () => {
    const customDir = join(tempDir, "custom");
    mkdtempSync(customDir + "-") || (() => {})();
    // Use the tempDir itself as the custom path (it already exists)
    const { deps, enqueue } = createFlowDeps(tempDir);
    enqueue(...happyPathAnswers());

    await initCommand([tempDir], deps);

    expect(existsSync(join(tempDir, "WORKFLOW.md"))).toBe(true);
  });
});
