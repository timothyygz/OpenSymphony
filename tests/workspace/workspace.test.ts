import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sanitizeKey, validateContainment } from "../../src/workspace/safety.ts";
import { WorkspaceManager } from "../../src/workspace/manager.ts";

const defaultConfig = { root: "", hooks: { timeout_ms: 5000 }, sources: [] as never[], workflowDir: "" };

describe("sanitizeKey", () => {
  it("preserves valid characters", () => {
    expect(sanitizeKey("MT-100")).toBe("MT-100");
    expect(sanitizeKey("abc.def")).toBe("abc.def");
    expect(sanitizeKey("MY_PROJECT")).toBe("MY_PROJECT");
  });

  it("replaces invalid characters with underscore", () => {
    expect(sanitizeKey("MT 100")).toBe("MT_100");
    expect(sanitizeKey("hello/world")).toBe("hello_world");
    expect(sanitizeKey("a@b#c")).toBe("a_b_c");
  });
});

describe("validateContainment", () => {
  it("allows paths inside root", () => {
    expect(validateContainment("/tmp/ws/MT-100", "/tmp/ws")).toBe(true);
  });

  it("allows exact root match", () => {
    expect(validateContainment("/tmp/ws", "/tmp/ws")).toBe(true);
  });

  it("rejects path traversal", () => {
    expect(validateContainment("/tmp/ws/../etc/passwd", "/tmp/ws")).toBe(false);
  });

  it("rejects sibling paths", () => {
    expect(validateContainment("/tmp/other", "/tmp/ws")).toBe(false);
  });
});

describe("WorkspaceManager", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "symphony-test-"));
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("creates workspace for new issue", async () => {
    const manager = new WorkspaceManager({ ...defaultConfig, root: tempRoot });
    const ws = await manager.createForIssue("MT-100");

    expect(ws.workspaceKey).toBe("MT-100");
    expect(ws.createdNow).toBe(true);
    expect(existsSync(ws.path)).toBe(true);
  });

  it("reuses existing workspace", async () => {
    const manager = new WorkspaceManager({ ...defaultConfig, root: tempRoot });
    const ws1 = await manager.createForIssue("MT-100");
    const ws2 = await manager.createForIssue("MT-100");

    expect(ws2.createdNow).toBe(false);
    expect(ws2.path).toBe(ws1.path);
  });

  it("sanitizes identifier in workspace key", async () => {
    const manager = new WorkspaceManager({ ...defaultConfig, root: tempRoot });
    const ws = await manager.createForIssue("MT 100/special");
    expect(ws.workspaceKey).toBe("MT_100_special");
  });

  it("cleans up workspace", async () => {
    const manager = new WorkspaceManager({ ...defaultConfig, root: tempRoot });
    const ws = await manager.createForIssue("MT-100");
    expect(existsSync(ws.path)).toBe(true);

    await manager.cleanupWorkspace("MT-100");
    expect(existsSync(ws.path)).toBe(false);
  });
});
