import { test, expect, describe } from "bun:test";
import { ANSI, colorize } from "../../src/tui/renderer.ts";

describe("ANSI constants", () => {
  test("reset contains ESC sequence", () => {
    expect(ANSI.reset).toContain("\x1b[");
  });

  test("color codes are valid ANSI sequences", () => {
    const colors = ["red", "green", "yellow", "blue", "magenta", "cyan", "gray"];
    for (const name of colors) {
      expect(ANSI[name]).toMatch(/^\x1b\[\d+m$/);
    }
  });

  test("bold is escape sequence 1m", () => {
    expect(ANSI.bold).toBe("\x1b[1m");
  });

  test("dim is escape sequence 2m", () => {
    expect(ANSI.dim).toBe("\x1b[2m");
  });

  test("home and clear are defined", () => {
    expect(ANSI.home).toBeTruthy();
    expect(ANSI.clear).toBeTruthy();
  });

  test("alt screen sequences are defined", () => {
    expect(ANSI.enterAltScreen).toBeTruthy();
    expect(ANSI.exitAltScreen).toBeTruthy();
  });
});

describe("colorize", () => {
  test("wraps text with color code and reset", () => {
    const result = colorize("hello", ANSI.red);
    expect(result).toBe(`${ANSI.red}hello${ANSI.reset}`);
  });

  test("works with bold", () => {
    const result = colorize("bold text", ANSI.bold);
    expect(result).toBe(`${ANSI.bold}bold text${ANSI.reset}`);
  });

  test("works with empty string", () => {
    const result = colorize("", ANSI.green);
    expect(result).toBe(`${ANSI.green}${ANSI.reset}`);
  });

  test("handles special characters", () => {
    const result = colorize("tab\there\nnewline", ANSI.cyan);
    expect(result).toContain(ANSI.cyan);
    expect(result).toContain(ANSI.reset);
    expect(result).toContain("tab\there\nnewline");
  });
});
