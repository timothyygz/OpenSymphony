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
      event: "token_usage",
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
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12);
    const lastWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 8, 12);
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate(), 12);

    const records = [
      { completedAt: today.toISOString(), totalTokens: 100 },
      { completedAt: yesterday.toISOString(), totalTokens: 200 },
      { completedAt: lastWeek.toISOString(), totalTokens: 400 },
      { completedAt: lastMonth.toISOString(), totalTokens: 800 },
    ];

    writeFileSync(path, records.map(r => record(r)).join("\n") + "\n");

    const result = await aggregate(path);

    // Compute expected using same period logic as aggregator
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const dow = now.getDay();
    const wdiff = dow === 0 ? 6 : dow - 1;
    const ws = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    ws.setDate(ws.getDate() - wdiff);
    const weekStart = ws.getTime();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    let et = 0, ew = 0, em = 0, ect = 0, ecw = 0, ecm = 0;
    for (const r of records) {
      const ts = new Date(r.completedAt).getTime();
      if (ts >= monthStart) { em += r.totalTokens; ecm++; }
      if (ts >= weekStart) { ew += r.totalTokens; ecw++; }
      if (ts >= dayStart) { et += r.totalTokens; ect++; }
    }

    expect(result.today.totalTokens).toBe(et);
    expect(result.today.issueCount).toBe(ect);
    expect(result.week.totalTokens).toBe(ew);
    expect(result.week.issueCount).toBe(ecw);
    expect(result.month.totalTokens).toBe(em);
    expect(result.month.issueCount).toBe(ecm);
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
