import { test, expect, describe, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TokenStore } from "../../src/metrics/token-store.ts";

describe("TokenStore", () => {
  let dir: string;
  let store: TokenStore;

  afterEach(() => {
    if (store) store.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function makeStore(): TokenStore {
    dir = mkdtempSync(join(tmpdir(), "token-store-test-"));
    const path = join(dir, "test.db");
    store = new TokenStore(path);
    return store;
  }

  function record(overrides: Partial<{
    identifier: string;
    issueId: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    turns: number;
    retryAttempt: number;
    completedAt: string;
  }> = {}) {
    return {
      identifier: "T-001",
      issueId: "r1",
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      turns: 1,
      retryAttempt: 0,
      completedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  test("append inserts a record and aggregate reflects it", () => {
    const s = makeStore();
    s.append(record({ totalTokens: 200 }));

    const stats = s.aggregate();
    expect(stats.today.totalTokens).toBe(200);
    expect(stats.today.inputTokens).toBe(100);
    expect(stats.today.outputTokens).toBe(50);
    expect(stats.today.issueCount).toBe(1);
  });

  test("append multiple records accumulate correctly", () => {
    const s = makeStore();
    s.append(record({ identifier: "A", issueId: "r1", inputTokens: 100, outputTokens: 50, totalTokens: 150 }));
    s.append(record({ identifier: "B", issueId: "r2", inputTokens: 200, outputTokens: 100, totalTokens: 300 }));

    const stats = s.aggregate();
    expect(stats.today.totalTokens).toBe(450);
    expect(stats.today.inputTokens).toBe(300);
    expect(stats.today.outputTokens).toBe(150);
    expect(stats.today.issueCount).toBe(2);
  });

  test("aggregate groups records by today/week/month", () => {
    const s = makeStore();
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12);
    const lastWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 8, 12);
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate(), 12);

    const records = [
      { completedAt: today.toISOString(), totalTokens: 100, inputTokens: 60, outputTokens: 40 },
      { completedAt: yesterday.toISOString(), totalTokens: 200, inputTokens: 120, outputTokens: 80 },
      { completedAt: lastWeek.toISOString(), totalTokens: 400, inputTokens: 240, outputTokens: 160 },
      { completedAt: lastMonth.toISOString(), totalTokens: 800, inputTokens: 480, outputTokens: 320 },
    ];

    for (const r of records) {
      s.append(record(r));
    }

    const result = s.aggregate();

    // Compute expected using same period logic
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

  test("aggregate returns zeros for empty database", () => {
    const s = makeStore();
    const result = s.aggregate();

    expect(result.today.totalTokens).toBe(0);
    expect(result.today.issueCount).toBe(0);
    expect(result.week.totalTokens).toBe(0);
    expect(result.month.totalTokens).toBe(0);
  });

  test("creates database file and parent directories", () => {
    dir = mkdtempSync(join(tmpdir(), "token-store-test-"));
    const path = join(dir, "nested", "dir", "test.db");
    store = new TokenStore(path);

    store.append(record());
    expect(store.aggregate().today.issueCount).toBe(1);
  });

  test("close and reopen preserves data", () => {
    const s = makeStore();
    s.append(record({ totalTokens: 500, inputTokens: 300, outputTokens: 200 }));
    s.close();

    // Reopen at same path
    const dbPath = join(dir!, "test.db");
    const s2 = new TokenStore(dbPath);
    const stats = s2.aggregate();
    expect(stats.today.totalTokens).toBe(500);
    expect(stats.today.issueCount).toBe(1);
    store = s2; // So afterEach closes it
  });
});
