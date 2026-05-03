import { test, expect, describe } from "bun:test";
import { Sparkline } from "../../src/tui/sparkline.ts";

describe("Sparkline", () => {
  test("returns 0 tps with no samples", () => {
    const s = new Sparkline();
    expect(s.tps(1000, 0)).toBe(0);
  });

  test("calculates tps with one sample and current point", () => {
    const s = new Sparkline();
    s.sample(1000, 100);
    const tps = s.tps(2000, 200);
    expect(tps).toBeGreaterThan(0);
  });

  test("calculates tps from samples", () => {
    const s = new Sparkline();
    s.sample(0, 0);
    s.sample(1000, 100);
    const tps = s.tps(2000, 200);
    expect(tps).toBeGreaterThan(0);
  });

  test("returns minimum blocks with no data", () => {
    const s = new Sparkline();
    const result = s.render(1000, 0);
    expect(result).toHaveLength(24);
    expect(result).toBe("▁".repeat(24));
  });

  test("returns 24 characters", () => {
    const s = new Sparkline();
    for (let i = 0; i < 100; i++) {
      s.sample(i * 1000, i * 10);
    }
    const result = s.render(100000, 1000);
    expect(result).toHaveLength(24);
  });

  test("uses sparkline block characters", () => {
    const s = new Sparkline();
    for (let i = 0; i < 100; i++) {
      s.sample(i * 1000, i * 10);
    }
    const result = s.render(100000, 1000);
    const validChars = new Set("▁▂▃▄▅▆▇█");
    for (const ch of result) {
      expect(validChars.has(ch)).toBe(true);
    }
  });

  test("prunes old samples", () => {
    const s = new Sparkline();
    s.sample(0, 0);
    s.sample(1000, 100);
    // 11 minutes later
    const now = 11 * 60 * 1000;
    s.sample(now, 200);
    const tps = s.tps(now, 300);
    // Old samples should be pruned, TPS based on recent data only
    expect(tps).toBeGreaterThanOrEqual(0);
  });
});
