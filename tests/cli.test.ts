import { test, describe, expect } from "bun:test";
import { parseArgs, formatError } from "../src/cli.ts";

// --- parseArgs ---

describe("parseArgs", () => {
  test("returns help:true for --help", () => {
    const result = parseArgs(["--help"]);
    expect(result.help).toBe(true);
    expect(result.noTui).toBe(false);
    expect(result.json).toBe(false);
  });

  test("returns help:true for -h", () => {
    const result = parseArgs(["-h"]);
    expect(result.help).toBe(true);
  });

  test("parses --no-tui flag", () => {
    const result = parseArgs(["--no-tui", "/some/path"]);
    expect(result.noTui).toBe(true);
    expect(result.workflowPath).toBe("/some/path");
  });

  test("parses --json flag", () => {
    const result = parseArgs(["--json", "/some/path"]);
    expect(result.json).toBe(true);
  });

  test("parses --state filter with subcommand", () => {
    const result = parseArgs(["tasks", "--state", "In Progress"]);
    expect(result.subcommand).toBe("tasks");
    expect(result.stateFilter).toBe("In Progress");
  });

  test("parses known subcommand", () => {
    const result = parseArgs(["version"]);
    expect(result.subcommand).toBe("version");
    expect(result.help).toBe(false);
    expect(result.unknownCommand).toBeUndefined();
  });

  test("passes remaining positional after subcommand", () => {
    const result = parseArgs(["task", "TASK-123", "/path/to/dir"]);
    expect(result.subcommand).toBe("task");
    expect(result.positional).toEqual(["TASK-123", "/path/to/dir"]);
  });

  test("detects unknown command (no slashes, no dots)", () => {
    const result = parseArgs(["foobar"]);
    expect(result.unknownCommand).toBe("foobar");
    expect(result.subcommand).toBeUndefined();
    expect(result.workflowPath).toBeUndefined();
  });

  test("treats path with slash as workflow path", () => {
    const result = parseArgs(["./WORKFLOW.md"]);
    expect(result.workflowPath).toBe("./WORKFLOW.md");
    expect(result.unknownCommand).toBeUndefined();
    expect(result.subcommand).toBeUndefined();
  });

  test("treats name with dot as workflow path", () => {
    const result = parseArgs(["WORKFLOW.md"]);
    expect(result.workflowPath).toBe("WORKFLOW.md");
    expect(result.unknownCommand).toBeUndefined();
  });

  test("treats absolute path as workflow path", () => {
    const result = parseArgs(["/home/user/project/WORKFLOW.md"]);
    expect(result.workflowPath).toBe("/home/user/project/WORKFLOW.md");
    expect(result.unknownCommand).toBeUndefined();
  });

  test("empty args returns defaults", () => {
    const result = parseArgs([]);
    expect(result.help).toBe(false);
    expect(result.noTui).toBe(false);
    expect(result.json).toBe(false);
    expect(result.subcommand).toBeUndefined();
    expect(result.workflowPath).toBeUndefined();
    expect(result.unknownCommand).toBeUndefined();
    expect(result.positional).toEqual([]);
  });

  test("all subcommands are recognized", () => {
    for (const cmd of ["init", "doctor", "version", "tasks", "task", "status", "config"]) {
      const result = parseArgs([cmd]);
      expect(result.subcommand).toBe(cmd);
    }
  });
});

// --- formatError ---

describe("formatError", () => {
  test("formats Error with stack trace", () => {
    const err = new Error("test error");
    const result = formatError(err);
    expect(result).toContain("test error");
    expect(result).toContain("Error");
  });

  test("formats string as-is", () => {
    expect(formatError("plain string")).toBe("plain string");
  });

  test("formats number via JSON.stringify", () => {
    expect(formatError(42)).toBe("42");
  });

  test("formats object via JSON.stringify", () => {
    expect(formatError({ code: "ERR", detail: "bad" })).toBe('{"code":"ERR","detail":"bad"}');
  });

  test("formats null via JSON.stringify", () => {
    expect(formatError(null)).toBe("null");
  });

  test("formats undefined via JSON.stringify", () => {
    expect(formatError(undefined)).toBeUndefined();
  });
});
