import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { TurnLog, writeMetaJson, updateMetaJson, readMetaJson, ensureSymphonyDir, SYMPHONY_DIR, TURNS_FILE, META_FILE } from "../../src/logging/turn-log.ts";

describe("TurnLog", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "symphony-turnlog-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates .symphony directory on construction", () => {
    new TurnLog(tempDir);
    expect(existsSync(resolve(tempDir, SYMPHONY_DIR))).toBe(true);
  });

  it("appends user prompt as JSONL", () => {
    const log = new TurnLog(tempDir);
    log.logUserPrompt(1, "Hello agent");

    const content = readFileSync(resolve(tempDir, SYMPHONY_DIR, TURNS_FILE), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(1);

    const entry = JSON.parse(lines[0]!);
    expect(entry.turn).toBe(1);
    expect(entry.role).toBe("user");
    expect(entry.content).toBe("Hello agent");
  });

  it("appends multiple entries", () => {
    const log = new TurnLog(tempDir);
    log.logUserPrompt(1, "Do task");
    log.logAssistantMessage(1, "Working on it");
    log.logToolUse(1, "Read", { file_path: "src/main.ts" });
    log.logToolResult(1, "Read", "file contents");

    const content = readFileSync(resolve(tempDir, SYMPHONY_DIR, TURNS_FILE), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(4);

    const toolResult = JSON.parse(lines[3]!);
    expect(toolResult.role).toBe("tool_result");
    expect(toolResult.tool).toBe("Read");
  });

  it("truncates large tool output", () => {
    const log = new TurnLog(tempDir);
    const longOutput = "x".repeat(15000);
    log.logToolResult(1, "Bash", longOutput);

    const content = readFileSync(resolve(tempDir, SYMPHONY_DIR, TURNS_FILE), "utf-8");
    const entry = JSON.parse(content.trim());
    expect(entry.output.length).toBeLessThan(11000);
    expect(entry.output).toContain("[truncated]");
  });
});

describe("meta.json", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "symphony-meta-test-"));
    ensureSymphonyDir(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("writes and reads meta.json", () => {
    const meta = {
      issueId: "rec123",
      identifier: "SYM-001",
      title: "Test",
      workspacePath: tempDir,
      sessionId: "sym-001-1234",
      joinCommand: "claude --resume --session-id sym-001-1234",
      startedAt: new Date().toISOString(),
      totalTurns: 0,
      totalTokens: 0,
    };

    writeMetaJson(tempDir, meta);
    const read = readMetaJson(tempDir);

    expect(read).not.toBeNull();
    expect(read!.issueId).toBe("rec123");
    expect(read!.identifier).toBe("SYM-001");
  });

  it("updates meta.json partially", () => {
    writeMetaJson(tempDir, {
      issueId: "rec123",
      identifier: "SYM-001",
      title: "Test",
      workspacePath: tempDir,
      sessionId: "sym-001",
      startedAt: new Date().toISOString(),
      totalTurns: 0,
      totalTokens: 0,
    });

    updateMetaJson(tempDir, { totalTurns: 3, totalTokens: 5000 });

    const read = readMetaJson(tempDir);
    expect(read!.totalTurns).toBe(3);
    expect(read!.totalTokens).toBe(5000);
    expect(read!.identifier).toBe("SYM-001"); // unchanged
  });

  it("returns null for missing meta.json", () => {
    const read = readMetaJson("/nonexistent/path");
    expect(read).toBeNull();
  });

  it("stores sources and sourcesHash", () => {
    writeMetaJson(tempDir, {
      issueId: "rec123",
      identifier: "SYM-001",
      title: "Test",
      workspacePath: tempDir,
      sessionId: "sym-001",
      startedAt: new Date().toISOString(),
      totalTurns: 0,
      totalTokens: 0,
      sources: [{ type: "git-clone" as const, url: "https://github.com/test/repo.git", path: "repo", depth: 1 }],
      sourcesHash: "abc123",
    });

    const read = readMetaJson(tempDir);
    expect(read!.sources).toHaveLength(1);
    expect(read!.sourcesHash).toBe("abc123");
  });
});
