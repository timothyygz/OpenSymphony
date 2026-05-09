import { test, describe, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  wizardResultToExportData,
  exportDataToWizardResult,
  writeExportFile,
  readImportFile,
} from "../../src/setup/export.ts";
import { validateImportData } from "../../src/setup/validate.ts";
import type { WizardResult, ExportData } from "../../src/setup/types.ts";

// --- Pure function tests ---

describe("wizardResultToExportData", () => {
  test("converts WizardResult to ExportData with version 1", () => {
    const result: WizardResult = {
      tracker: { kind: "gitlab_issues", gitlab_host: "https://gitlab.com", project_id: "42" },
      workspace: { root: "~/workspace" },
      agent: { config: { approval_policy: "auto" } },
      promptTemplate: "Hello",
      credentials: { gitlab_token: "glpat-test" },
    };

    const data = wizardResultToExportData(result);

    expect(data.version).toBe(1);
    expect(typeof data.exportedAt).toBe("string");
    expect(data.tracker.kind).toBe("gitlab_issues");
    expect(data.tracker.config.kind).toBe("gitlab_issues");
    expect(data.tracker.credentials?.gitlab_token).toBe("glpat-test");
    expect(data.promptTemplate).toBe("Hello");
  });

  test("handles result without credentials", () => {
    const result: WizardResult = {
      tracker: { kind: "github_issues", github_host: "https://github.com", owner: "org", repo: "repo" },
      workspace: { root: "~/workspace" },
      agent: { config: { approval_policy: "auto" } },
      promptTemplate: "Hello",
    };

    const data = wizardResultToExportData(result);

    expect(data.tracker.credentials).toBeUndefined();
  });
});

describe("exportDataToWizardResult", () => {
  test("round-trips correctly", () => {
    const original: WizardResult = {
      tracker: { kind: "feishu_bitable", app_token: "abc", table_id: "tbl123" },
      workspace: { root: "~/ws" },
      agent: { config: { approval_policy: "suggest" } },
      promptTemplate: "Test",
      credentials: { app_id: "cli_xxx", app_secret: "secret" },
    };

    const exported = wizardResultToExportData(original);
    const restored = exportDataToWizardResult(exported);

    expect(restored.tracker.kind).toBe("feishu_bitable");
    expect(restored.tracker.app_token).toBe("abc");
    expect(restored.credentials?.app_id).toBe("cli_xxx");
    expect(restored.promptTemplate).toBe("Test");
  });
});

// --- File I/O tests ---

describe("writeExportFile / readImportFile", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "symphony-export-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("writes and reads back valid export data", () => {
    const data: ExportData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      tracker: {
        kind: "github_issues",
        config: {
          kind: "github_issues",
          github_host: "https://github.com",
          owner: "org",
          repo: "repo",
          active_states: ["Todo"],
          terminal_states: ["Done"],
        },
        credentials: { github_token: "ghp_secret" },
      },
      agent: { config: { approval_policy: "auto" } },
      workspace: { root: "~/workspace" },
      polling: {},
      promptTemplate: "Hello",
    };

    const filePath = join(tempDir, "config.json");
    writeExportFile(data, filePath);

    expect(existsSync(filePath)).toBe(true);

    const readResult = readImportFile(filePath);
    expect(readResult.ok).toBe(true);
    if (readResult.ok) {
      expect(readResult.data.tracker.kind).toBe("github_issues");
      expect(readResult.data.tracker.credentials?.github_token).toBe("ghp_secret");
      expect(readResult.data.promptTemplate).toBe("Hello");
    }
  });

  test("readImportFile returns error for missing file", () => {
    const result = readImportFile(join(tempDir, "nonexistent.json"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toContain("not found");
    }
  });

  test("readImportFile returns error for invalid JSON", () => {
    const badPath = join(tempDir, "bad.json");
    writeFileSync(badPath, "not valid json {{{");
    const result = readImportFile(badPath);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toContain("Invalid JSON");
    }
  });

  test("readImportFile returns error for wrong version", () => {
    const filePath = join(tempDir, "wrong-version.json");
    writeFileSync(filePath, JSON.stringify({
      version: 2,
      tracker: { kind: "test", config: {} },
      agent: {},
      workspace: {},
      promptTemplate: "hello",
    }));
    const result = readImportFile(filePath);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("Unsupported version"))).toBe(true);
    }
  });

  test("readImportFile returns error for missing tracker.kind", () => {
    const filePath = join(tempDir, "no-kind.json");
    writeFileSync(filePath, JSON.stringify({
      version: 1,
      tracker: { config: {} },
      agent: {},
      workspace: {},
      promptTemplate: "hello",
    }));
    const result = readImportFile(filePath);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("tracker.kind"))).toBe(true);
    }
  });

  test("readImportFile returns error for missing promptTemplate", () => {
    const filePath = join(tempDir, "no-template.json");
    writeFileSync(filePath, JSON.stringify({
      version: 1,
      tracker: { kind: "test", config: {} },
      agent: {},
      workspace: {},
    }));
    const result = readImportFile(filePath);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("promptTemplate"))).toBe(true);
    }
  });
});

// --- validateImportData detailed tests ---

describe("validateImportData", () => {
  test("accepts valid import with all fields", () => {
    const result = validateImportData({
      version: 1,
      tracker: { kind: "gitlab_issues", config: { kind: "gitlab_issues" } },
      agent: { config: { approval_policy: "auto" } },
      workspace: { root: "~/ws" },
      promptTemplate: "Hello",
    });
    expect(result.valid).toBe(true);
  });

  test("rejects non-object input", () => {
    const result = validateImportData("not an object");
    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe("root");
  });

  test("rejects null input", () => {
    const result = validateImportData(null);
    expect(result.valid).toBe(false);
  });

  test("rejects missing tracker.config", () => {
    const result = validateImportData({
      version: 1,
      tracker: { kind: "test" },
      agent: {},
      workspace: {},
      promptTemplate: "hello",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "tracker.config")).toBe(true);
  });

  test("includes suggestion for wrong version", () => {
    const result = validateImportData({
      version: 99,
      tracker: { kind: "test", config: {} },
      agent: {},
      workspace: {},
      promptTemplate: "hello",
    });
    expect(result.valid).toBe(false);
    const versionError = result.errors.find((e) => e.field === "version");
    expect(versionError).toBeDefined();
    expect(versionError!.suggestion).toBeDefined();
  });
});
