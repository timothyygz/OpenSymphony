import { test, describe, expect, beforeEach, afterEach } from "bun:test";
import { createMockPrompts, CANCEL } from "../__mocks__/clack-prompts.ts";
import { initCommand } from "../../src/setup/wizard.ts";
import type { InitDeps, SetupApi } from "../../src/setup/types.ts";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "../../src/setup/args.ts";
import { nonInteractiveInit } from "../../src/setup/non-interactive.ts";
import { validateWizardResult, validateWizardResultDetailed, validateImportData } from "../../src/setup/validate.ts";
import { wizardResultToExportData, exportDataToWizardResult, readImportFile, writeExportFile } from "../../src/setup/export.ts";
import type { WizardResult, ExportData } from "../../src/setup/types.ts";

// --- Shared helpers ---

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

function createMockDeps(setupApiOverrides: Partial<SetupApi> = {}): {
  deps: InitDeps;
  enqueue: (...values: unknown[]) => void;
  reset: () => void;
} {
  const { prompts, enqueue, reset } = createMockPrompts();
  const deps: InitDeps = {
    prompts,
    createSetupApi: () => createMockSetupApi(setupApiOverrides),
    checkClaudeCli: async () => true,
    homedir: () => "/tmp/test-home",
  };
  return { deps, enqueue, reset };
}

// --- parseArgs tests ---

describe("parseArgs", () => {
  test("parses --dry-run", () => {
    const args = parseArgs(["--dry-run"]);
    expect(args.dryRun).toBe(true);
  });

  test("parses --export with path", () => {
    const args = parseArgs(["--export", "my-config.json"]);
    expect(args.exportPath).toBe("my-config.json");
  });

  test("parses --import with path", () => {
    const args = parseArgs(["--import", "saved-config.json"]);
    expect(args.importPath).toBe("saved-config.json");
  });

  test("parses --github-* args", () => {
    const args = parseArgs([
      "--github-host", "https://github.example.com",
      "--github-token", "ghp_test",
      "--github-owner", "org",
      "--github-repo", "repo",
    ]);
    expect(args.githubHost).toBe("https://github.example.com");
    expect(args.githubToken).toBe("ghp_test");
    expect(args.githubOwner).toBe("org");
    expect(args.githubRepo).toBe("repo");
  });

  test("ignores non-flag arguments", () => {
    const args = parseArgs(["some-path", "--tracker", "feishu_bitable"]);
    expect(args.tracker).toBe("feishu_bitable");
  });
});

// --- nonInteractiveInit with --import ---

describe("nonInteractiveInit with --import", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "symphony-import-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("imports from valid export file", () => {
    const exportData: ExportData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      tracker: {
        kind: "github_issues",
        config: {
          kind: "github_issues",
          github_host: "https://github.com",
          owner: "my-org",
          repo: "my-repo",
          active_states: ["Todo", "In Progress"],
          terminal_states: ["Done", "Cancelled"],
        },
        credentials: { github_token: "ghp_test" },
      },
      agent: { config: { approval_policy: "auto" } },
      workspace: { root: "~/workspace" },
      polling: { interval_ms: 30000 },
      promptTemplate: "Hello world",
    };
    const exportPath = join(tempDir, "export.json");
    writeFileSync(exportPath, JSON.stringify(exportData));

    const result = nonInteractiveInit({
      nonInteractive: true,
      importPath: exportPath,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.tracker.kind).toBe("github_issues");
      expect(result.result.credentials?.github_token).toBe("ghp_test");
      expect(result.result.promptTemplate).toBe("Hello world");
    }
  });

  test("returns error for missing import file", () => {
    const result = nonInteractiveInit({
      nonInteractive: true,
      importPath: "/nonexistent/file.json",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain("not found");
    }
  });

  test("returns error for invalid JSON", () => {
    const badPath = join(tempDir, "bad.json");
    writeFileSync(badPath, "not json {{{");

    const result = nonInteractiveInit({
      nonInteractive: true,
      importPath: badPath,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toContain("Invalid JSON");
    }
  });
});

// --- nonInteractiveInit with github_issues ---

describe("nonInteractiveInit — github_issues", () => {
  test("happy path with all required args", () => {
    const result = nonInteractiveInit({
      nonInteractive: true,
      tracker: "github_issues",
      githubToken: "ghp_test",
      githubOwner: "org",
      githubRepo: "repo",
      githubHost: "https://github.com",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.tracker.kind).toBe("github_issues");
      expect(result.result.tracker.owner).toBe("org");
      expect(result.result.tracker.repo).toBe("repo");
      expect(result.result.credentials?.github_token).toBe("ghp_test");
    }
  });

  test("returns error without --github-token", () => {
    const result = nonInteractiveInit({
      nonInteractive: true,
      tracker: "github_issues",
      githubOwner: "org",
      githubRepo: "repo",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("github-token"))).toBe(true);
    }
  });

  test("returns error without --github-owner", () => {
    const result = nonInteractiveInit({
      nonInteractive: true,
      tracker: "github_issues",
      githubToken: "ghp_test",
      githubRepo: "repo",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("github-owner"))).toBe(true);
    }
  });

  test("defaults host to https://github.com", () => {
    const result = nonInteractiveInit({
      nonInteractive: true,
      tracker: "github_issues",
      githubToken: "ghp_test",
      githubOwner: "org",
      githubRepo: "repo",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.tracker.github_host).toBe("https://github.com");
    }
  });
});

// --- validateWizardResultDetailed ---

describe("validateWizardResultDetailed", () => {
  test("returns suggestions for each error", () => {
    const result = validateWizardResultDetailed({
      tracker: {},
      workspace: {},
      agent: {},
      promptTemplate: "",
    });

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    // Each error should have a suggestion
    for (const err of result.errors) {
      expect(err.suggestion).toBeDefined();
    }
  });

  test("validates github_issues config", () => {
    const result = validateWizardResultDetailed({
      tracker: {
        kind: "github_issues",
        github_host: "https://github.com",
        owner: "org",
        repo: "repo",
        active_states: ["Todo"],
        terminal_states: ["Done"],
      },
      workspace: { root: "~/workspace" },
      agent: { config: { approval_policy: "auto" } },
      promptTemplate: "Hello",
      credentials: { github_token: "ghp_test" },
    });

    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  test("catches missing github_issues fields", () => {
    const result = validateWizardResultDetailed({
      tracker: { kind: "github_issues" },
      workspace: { root: "~/workspace" },
      agent: { config: { approval_policy: "auto" } },
      promptTemplate: "Hello",
    });

    expect(result.valid).toBe(false);
    const fields = result.errors.map((e) => e.field);
    expect(fields).toContain("tracker.github_host");
    expect(fields).toContain("tracker.owner");
    expect(fields).toContain("tracker.repo");
    expect(fields).toContain("tracker.active_states");
    expect(fields).toContain("tracker.terminal_states");
  });

  test("warns when credentials missing but tracker kind is set", () => {
    const result = validateWizardResultDetailed({
      tracker: {
        kind: "github_issues",
        github_host: "https://github.com",
        owner: "org",
        repo: "repo",
        active_states: ["Todo"],
        terminal_states: ["Done"],
      },
      workspace: { root: "~/workspace" },
      agent: { config: { approval_policy: "auto" } },
      promptTemplate: "Hello",
    });

    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0].field).toBe("credentials");
  });
});

// --- validateImportData ---

describe("validateImportData", () => {
  test("validates a correct import structure", () => {
    const result = validateImportData({
      version: 1,
      tracker: { kind: "github_issues", config: { kind: "github_issues" } },
      agent: { config: { approval_policy: "auto" } },
      workspace: { root: "~/ws" },
      promptTemplate: "Hello",
    });

    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  test("rejects wrong version", () => {
    const result = validateImportData({
      version: 2,
      tracker: { kind: "test" },
      promptTemplate: "hello",
      agent: {},
      workspace: {},
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe("version");
    expect(result.errors[0].suggestion).toBeDefined();
  });

  test("rejects non-object", () => {
    const result = validateImportData("not an object");

    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe("root");
  });

  test("rejects missing tracker.kind", () => {
    const result = validateImportData({
      version: 1,
      tracker: { config: {} },
      agent: {},
      workspace: {},
      promptTemplate: "hello",
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe("tracker.kind");
  });
});

// --- Export/Import round-trip ---

describe("export/import round-trip", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "symphony-roundtrip-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("export → import preserves all data", () => {
    const original: WizardResult = {
      tracker: {
        kind: "github_issues",
        github_host: "https://github.com",
        owner: "test-org",
        repo: "test-repo",
        active_states: ["Todo", "In Progress"],
        terminal_states: ["Done", "Cancelled"],
      },
      workspace: { root: "~/workspace", sources: [{ type: "git-clone", url: "git@github.com:org/repo.git", path: "repo", depth: 1 }] },
      agent: { config: { approval_policy: "suggest" } },
      promptTemplate: "Test template content",
      credentials: { github_token: "ghp_secret" },
    };

    const exportData = wizardResultToExportData(original);
    expect(exportData.version).toBe(1);
    expect(exportData.tracker.kind).toBe("github_issues");
    expect(exportData.tracker.credentials?.github_token).toBe("ghp_secret");

    // Write and read back
    const filePath = join(tempDir, "export.json");
    writeExportFile(exportData, filePath);
    expect(existsSync(filePath)).toBe(true);

    const readResult = readImportFile(filePath);
    expect(readResult.ok).toBe(true);
    if (readResult.ok) {
      const restored = exportDataToWizardResult(readResult.data);
      expect(restored.tracker.kind).toBe("github_issues");
      expect(restored.tracker.owner).toBe("test-org");
      expect(restored.credentials?.github_token).toBe("ghp_secret");
      expect(restored.promptTemplate).toBe("Test template content");
    }
  });
});

// --- Error recovery (backup/restore) ---

describe("error recovery — backup/restore on write failure", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "symphony-recovery-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("non-interactive dry-run does not write files", async () => {
    const { deps, enqueue } = createMockDeps();
    deps.homedir = () => tempDir;

    // Use non-interactive with dry-run
    await initCommand([
      "--non-interactive",
      "--dry-run",
      "--tracker", "github_issues",
      "--github-token", "ghp_test",
      "--github-owner", "org",
      "--github-repo", "repo",
      tempDir,
    ], deps);

    expect(existsSync(join(tempDir, "WORKFLOW.md"))).toBe(false);
  });

  test("non-interactive --export writes JSON but no WORKFLOW.md", async () => {
    const { deps, enqueue } = createMockDeps();
    deps.homedir = () => tempDir;
    const exportPath = join(tempDir, "config.json");

    await initCommand([
      "--non-interactive",
      "--export", exportPath,
      "--tracker", "github_issues",
      "--github-token", "ghp_test",
      "--github-owner", "org",
      "--github-repo", "repo",
      tempDir,
    ], deps);

    expect(existsSync(exportPath)).toBe(true);
    expect(existsSync(join(tempDir, "WORKFLOW.md"))).toBe(false);

    const exported = JSON.parse(readFileSync(exportPath, "utf-8"));
    expect(exported.version).toBe(1);
    expect(exported.tracker.kind).toBe("github_issues");
  });
});
