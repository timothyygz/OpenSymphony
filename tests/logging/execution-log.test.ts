import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ExecutionLog, type DispatchEvent, type WorkerExitEvent } from "../../src/logging/execution-log.ts";

let tempDir: string;
let logPath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "execution-log-test-"));
  logPath = join(tempDir, "test-execution.jsonl");
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("ExecutionLog", () => {
  describe("append", () => {
    it("writes a JSONL line for a dispatch event", async () => {
      const log = new ExecutionLog(logPath);
      await log.append({
        event: "dispatch",
        timestamp: new Date().toISOString(),
        issueId: "rec_123",
        identifier: "SYMP-001",
        attempt: 0,
      });

      expect(existsSync(logPath)).toBe(true);
      const lines = readFileSync(logPath, "utf-8").trim().split("\n");
      expect(lines).toHaveLength(1);
      const parsed = JSON.parse(lines[0]!) as DispatchEvent;
      expect(parsed.event).toBe("dispatch");
      expect(parsed.identifier).toBe("SYMP-001");
      expect(parsed.attempt).toBe(0);
    });

    it("appends multiple events", async () => {
      const log = new ExecutionLog(logPath);
      await log.append({
        event: "dispatch",
        timestamp: new Date().toISOString(),
        issueId: "rec_123",
        identifier: "SYMP-001",
        attempt: 0,
      });
      await log.append({
        event: "worker_exit",
        timestamp: new Date().toISOString(),
        issueId: "rec_123",
        identifier: "SYMP-001",
        reason: "normal",
        turns: 3,
        totalTokens: 1000,
      });

      const lines = readFileSync(logPath, "utf-8").trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[1]!).event).toBe("worker_exit");
    });

    it("tolerates write failure gracefully (read-only dir)", async () => {
      const readOnlyPath = "/dev/null/impossible-path/test.jsonl";
      const log = new ExecutionLog(readOnlyPath);
      // Should not throw
      await log.append({
        event: "dispatch",
        timestamp: new Date().toISOString(),
        issueId: "rec_123",
        identifier: "SYMP-001",
        attempt: 0,
      });
    });
  });

  describe("queryByIdentifier", () => {
    it("returns events matching the identifier", async () => {
      const log = new ExecutionLog(logPath);
      await log.append({
        event: "dispatch",
        timestamp: "2026-05-03T10:00:00.000Z",
        issueId: "rec_1",
        identifier: "SYMP-001",
        attempt: 0,
      });
      await log.append({
        event: "dispatch",
        timestamp: "2026-05-03T10:00:01.000Z",
        issueId: "rec_2",
        identifier: "SYMP-002",
        attempt: 0,
      });
      await log.append({
        event: "worker_exit",
        timestamp: "2026-05-03T10:05:00.000Z",
        issueId: "rec_1",
        identifier: "SYMP-001",
        reason: "normal",
        turns: 5,
        totalTokens: 2000,
      });

      const events = await log.queryByIdentifier("SYMP-001");
      expect(events).toHaveLength(2);
      expect(events[0]!.event).toBe("dispatch");
      expect(events[1]!.event).toBe("worker_exit");
    });

    it("returns empty array for non-existent file", async () => {
      const log = new ExecutionLog(join(tempDir, "nonexistent.jsonl"));
      const events = await log.queryByIdentifier("SYMP-999");
      expect(events).toHaveLength(0);
    });

    it("returns empty array when no events match", async () => {
      const log = new ExecutionLog(logPath);
      await log.append({
        event: "dispatch",
        timestamp: new Date().toISOString(),
        issueId: "rec_1",
        identifier: "SYMP-001",
        attempt: 0,
      });

      const events = await log.queryByIdentifier("SYMP-999");
      expect(events).toHaveLength(0);
    });
  });
});
