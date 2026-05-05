import { test, expect, describe } from "bun:test";
import { formatHistory } from "../../src/tui/layout.ts";
import type { HistoryStats } from "../../src/model/session.ts";
import { ANSI } from "../../src/tui/renderer.ts";

function makeStats(overrides: Partial<{ totalTokens: number; issueCount: number }> = {}): HistoryStats {
  const stats = {
    inputTokens: overrides.totalTokens ? Math.floor(overrides.totalTokens * 0.6) : 0,
    outputTokens: overrides.totalTokens ? Math.floor(overrides.totalTokens * 0.4) : 0,
    totalTokens: overrides.totalTokens ?? 0,
    issueCount: overrides.issueCount ?? 0,
  };
  return { today: stats, week: stats, month: stats };
}

describe("formatHistory", () => {
  test("renders all three periods", () => {
    const history: HistoryStats = {
      today: { inputTokens: 600, outputTokens: 400, totalTokens: 1000, issueCount: 3 },
      week: { inputTokens: 6000, outputTokens: 4000, totalTokens: 10000, issueCount: 15 },
      month: { inputTokens: 15000, outputTokens: 10000, totalTokens: 25000, issueCount: 42 },
    };

    const lines = formatHistory(history);

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("History");
    expect(lines[1]).toContain("Today");
    expect(lines[1]).toContain("Week");
    expect(lines[1]).toContain("Month");
    expect(lines[1]).toContain("1,000 tokens");
    expect(lines[1]).toContain("10,000 tokens");
    expect(lines[1]).toContain("25,000 tokens");
    expect(lines[1]).toContain("3 issues");
    expect(lines[1]).toContain("15 issues");
    expect(lines[1]).toContain("42 issues");
  });

  test("renders zeros when no data", () => {
    const history = makeStats();
    const lines = formatHistory(history);

    expect(lines[1]).toContain("0 tokens");
    expect(lines[1]).toContain("0 issues");
  });

  test("uses color codes", () => {
    const history: HistoryStats = {
      today: { inputTokens: 100, outputTokens: 50, totalTokens: 150, issueCount: 1 },
      week: { inputTokens: 500, outputTokens: 250, totalTokens: 750, issueCount: 5 },
      month: { inputTokens: 2000, outputTokens: 1000, totalTokens: 3000, issueCount: 10 },
    };

    const lines = formatHistory(history);

    // ANSI color codes should be present
    expect(lines[1]).toContain(ANSI.cyan);
    expect(lines[1]).toContain(ANSI.magenta);
    expect(lines[1]).toContain(ANSI.yellow);
    expect(lines[1]).toContain(ANSI.gray);
  });
});
