import { test, expect, describe } from "bun:test";
import { displayWidth, padCell, truncate, formatCount, formatRuntime } from "../../src/tui/format.ts";

describe("displayWidth", () => {
  test("ASCII string returns length", () => {
    expect(displayWidth("hello")).toBe(5);
  });

  test("CJK characters count as 2", () => {
    expect(displayWidth("进行中")).toBe(6);
  });

  test("mixed ASCII and CJK", () => {
    expect(displayWidth("AB进行")).toBe(6);
  });

  test("empty string", () => {
    expect(displayWidth("")).toBe(0);
  });

  test("fullwidth characters", () => {
    expect(displayWidth("！")).toBe(2);
  });
});

describe("padCell", () => {
  test("pads ASCII to width", () => {
    expect(padCell("hi", 5)).toBe("hi   ");
  });

  test("pads CJK accounting for display width", () => {
    const result = padCell("进行中", 10);
    expect(displayWidth(result)).toBe(10);
  });

  test("right-aligns when specified", () => {
    expect(padCell("42", 5, "right")).toBe("   42");
  });

  test("no padding when exact width", () => {
    expect(padCell("hello", 5)).toBe("hello");
  });
});

describe("truncate", () => {
  test("does not truncate short strings", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  test("truncates and adds ...", () => {
    expect(truncate("hello world", 8)).toBe("hello...");
  });

  test("truncates CJK strings", () => {
    const result = truncate("进行中文字符测试", 8);
    expect(displayWidth(result)).toBeLessThanOrEqual(8);
    expect(result.endsWith("...")).toBe(true);
  });
});

describe("formatCount", () => {
  test("formats with thousand separators", () => {
    expect(formatCount(1234567)).toBe("1,234,567");
  });

  test("handles small numbers", () => {
    expect(formatCount(42)).toBe("42");
  });

  test("handles zero", () => {
    expect(formatCount(0)).toBe("0");
  });

  test("handles null", () => {
    expect(formatCount(null)).toBe("0");
  });

  test("handles undefined", () => {
    expect(formatCount(undefined)).toBe("0");
  });
});

describe("formatRuntime", () => {
  test("formats seconds into minutes and seconds", () => {
    expect(formatRuntime(125)).toBe("2m 5s");
  });

  test("handles zero", () => {
    expect(formatRuntime(0)).toBe("0m 0s");
  });

  test("handles exactly one minute", () => {
    expect(formatRuntime(60)).toBe("1m 0s");
  });
});
