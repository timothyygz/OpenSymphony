import { test, expect, describe, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { aggregate } from "../../src/metrics/aggregator.ts";

describe("aggregate", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function makePath() {
    dir = mkdtempSync(join(tmpdir(), "agg-test-"));
    return join(dir, "tokens.jsonl");
  }

  function record(overrides: Partial<{ identifier: string; issueId: string; inputTokens: number; outputTokens: number; totalTokens: number; turns: number; retryAttempt: number; completedAt: string }> = {}) {
    return JSON.stringify({
      identifier: "T-001",
      issueId: "r1",
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      turns: 1,
      retryAttempt: 0,
      completedAt: new Date().toISOString(),
      ...overrides,
    });
  }

  test("groups records by today/week/month", async () => {
    const path = makePath();
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
    const yesterday = new Date(today.getTime() - 86400000);
    const lastWeek = new Date(today.getTime() - 8 * 86400000);
    const lastMonth = new Date(today);
    lastMonth.setMonth(lastMonth.getMonth() - 1);

    writeFileSync(path, [
      record({ completedAt: today.toISOString(), totalTokens: 100 }),
      record({ completedAt: yesterday.toISOString(), totalTokens: 200 }),
      record({ completedAt: lastWeek.toISOString(), totalTokens: 400 }),
      record({ completedAt: lastMonth.toISOString(), totalTokens: 800 }),
    ].join("\n") + "\n");

    const result = await aggregate(path);

    // Today: only today's record
    expect(result.today.totalTokens).toBe(100);
    expect(result.today.issueCount).toBe(1);

    // Week: today + yesterday
    expect(result.week.totalTokens).toBe(300);
    expect(result.week.issueCount).toBe(2);

    // Month: today + yesterday (lastWeek and lastMonth are outside this month)
    expect(result.month.totalTokens).toBe(300);
    expect(result.month.issueCount).toBe(2);
  });

  test("returns zeros for missing file", async () => {
    dir = mkdtempSync(join(tmpdir(), "agg-test-"));
    const path = join(dir, "nonexistent.jsonl");
    const result = await aggregate(path);

    expect(result.today.totalTokens).toBe(0);
    expect(result.week.totalTokens).toBe(0);
    expect(result.month.totalTokens).toBe(0);
    expect(result.today.issueCount).toBe(0);
  });

  test("returns zeros for empty file", async () => {
    const path = makePath();
    writeFileSync(path, "");
    const result = await aggregate(path);

    expect(result.today.totalTokens).toBe(0);
    expect(result.week.totalTokens).toBe(0);
    expect(result.month.totalTokens).toBe(0);
  });

  test("skips corrupted lines", async () => {
    const path = makePath();
    writeFileSync(path, [
      record({ totalTokens: 100 }),
      "CORRUPTED LINE",
      record({ totalTokens: 200 }),
      "",
      "  ",
    ].join("\n") + "\n");

    const result = await aggregate(path);
    expect(result.today.totalTokens).toBe(300);
    expect(result.today.issueCount).toBe(2);
  });

  test("skips records with invalid completedAt", async () => {
    const path = makePath();
    writeFileSync(path, [
      record({ totalTokens: 100 }),
      JSON.stringify({ inputTokens: 50, outputTokens: 25, totalTokens: 75, completedAt: "not-a-date" }),
    ].join("\n") + "\n");

    const result = await aggregate(path);
    expect(result.today.totalTokens).toBe(100);
    expect(result.today.issueCount).toBe(1);
  });
});
