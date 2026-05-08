import { test, expect, describe } from "bun:test";
import { formatRuntime, formatCount, displayWidth, padCell, truncate } from "../../src/tui/format.ts";

describe("formatRuntime - enhanced", () => {
  test("formats seconds only for under a minute", () => {
    expect(formatRuntime(45)).toBe("0m 45s");
  });

  test("formats minutes and seconds", () => {
    expect(formatRuntime(125)).toBe("2m 5s");
  });

  test("formats hours, minutes and seconds", () => {
    expect(formatRuntime(3725)).toBe("1h 2m 5s");
  });

  test("formats multiple hours", () => {
    expect(formatRuntime(7325)).toBe("2h 2m 5s");
  });

  test("formats days, hours and minutes", () => {
    expect(formatRuntime(90125)).toBe("1d 1h 2m");
  });

  test("formats multiple days", () => {
    expect(formatRuntime(180245)).toBe("2d 2h 4m");
  });

  test("handles zero", () => {
    expect(formatRuntime(0)).toBe("0m 0s");
  });

  test("handles exactly one hour", () => {
    expect(formatRuntime(3600)).toBe("1h 0m 0s");
  });

  test("handles exactly one day", () => {
    expect(formatRuntime(86400)).toBe("1d 0h 0m");
  });
});

describe("formatCount", () => {
  test("formats thousands", () => {
    expect(formatCount(1234567)).toBe("1,234,567");
  });

  test("formats small numbers", () => {
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
