import { test, expect, describe, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TokenLog } from "../../src/metrics/token-log.ts";

describe("TokenLog", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  test("append creates file and writes JSON line", async () => {
    dir = mkdtempSync(join(tmpdir(), "token-test-"));
    const path = join(dir, "tokens.jsonl");
    const log = new TokenLog(path);

    await log.append({
      identifier: "SUDI-42",
      issueId: "rec123",
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
      turns: 3,
      retryAttempt: 0,
      completedAt: "2026-05-03T00:00:00.000Z",
    });

    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, "utf-8");
    const parsed = JSON.parse(content.trim());
    expect(parsed.identifier).toBe("SUDI-42");
    expect(parsed.totalTokens).toBe(1500);
  });

  test("append adds multiple lines", async () => {
    dir = mkdtempSync(join(tmpdir(), "token-test-"));
    const path = join(dir, "tokens.jsonl");
    const log = new TokenLog(path);

    await log.append({ identifier: "A", issueId: "r1", inputTokens: 100, outputTokens: 50, totalTokens: 150, turns: 1, retryAttempt: 0, completedAt: "2026-05-03T00:00:00.000Z" });
    await log.append({ identifier: "B", issueId: "r2", inputTokens: 200, outputTokens: 100, totalTokens: 300, turns: 2, retryAttempt: 0, completedAt: "2026-05-03T00:00:00.000Z" });

    const lines = readFileSync(path, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);
  });

  test("summary aggregates all records", async () => {
    dir = mkdtempSync(join(tmpdir(), "token-test-"));
    const path = join(dir, "tokens.jsonl");
    const log = new TokenLog(path);

    await log.append({ identifier: "A", issueId: "r1", inputTokens: 100, outputTokens: 50, totalTokens: 150, turns: 1, retryAttempt: 0, completedAt: "2026-05-03T00:00:00.000Z" });
    await log.append({ identifier: "B", issueId: "r2", inputTokens: 200, outputTokens: 100, totalTokens: 300, turns: 2, retryAttempt: 0, completedAt: "2026-05-03T00:00:00.000Z" });

    const s = await log.summary();
    expect(s.totalInput).toBe(300);
    expect(s.totalOutput).toBe(150);
    expect(s.totalTokens).toBe(450);
    expect(s.issueCount).toBe(2);
  });

  test("summary returns zeros when file does not exist", async () => {
    dir = mkdtempSync(join(tmpdir(), "token-test-"));
    const path = join(dir, "nonexistent.jsonl");
    const log = new TokenLog(path);

    const s = await log.summary();
    expect(s.totalTokens).toBe(0);
    expect(s.issueCount).toBe(0);
  });

  test("summary skips corrupted lines", async () => {
    dir = mkdtempSync(join(tmpdir(), "token-test-"));
    const path = join(dir, "tokens.jsonl");

    // Write valid + corrupted data
    const { writeFileSync } = await import("node:fs");
    writeFileSync(path, '{"identifier":"A","issueId":"r1","inputTokens":100,"outputTokens":50,"totalTokens":150,"turns":1,"retryAttempt":0,"completedAt":"2026-05-03"}\nCORRUPTED\n{"identifier":"B","issueId":"r2","inputTokens":200,"outputTokens":100,"totalTokens":300,"turns":2,"retryAttempt":0,"completedAt":"2026-05-03"}\n');

    const log = new TokenLog(path);
    const s = await log.summary();
    expect(s.totalTokens).toBe(450);
    expect(s.issueCount).toBe(2);
  });
});
