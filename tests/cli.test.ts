import { test, describe, expect, mock } from "bun:test";
import {
  parseArgs,
  formatError,
  setupGracefulShutdown,
} from "../src/cli.ts";

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

  test("handles circular reference gracefully (no silent catch)", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    // JSON.stringify would throw on circular refs — formatError falls back to String()
    const result = formatError(circular);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

// --- setupGracefulShutdown ---

describe("setupGracefulShutdown", () => {
  test("registers SIGINT and SIGTERM handlers", () => {
    const registeredEvents: string[] = [];
    const origExit = process.exit;
    process.exit = (() => {}) as never;

    const origProcessOn = process.on;
    process.on = ((event: string, _handler: (...args: unknown[]) => void) => {
      registeredEvents.push(event);
      return process;
    }) as never;

    try {
      const orchestratorMock = { stop: mock(() => Promise.resolve()) };
      const watcherMock = { stop: mock(() => {}) };
      const tokenStoreMock = { close: mock(() => {}) };
      const loggerMock = { info: mock(() => {}) };

      setupGracefulShutdown({
        orchestrator: orchestratorMock as never,
        watcher: watcherMock as never,
        dashboard: null,
        tokenStore: tokenStoreMock as never,
        logger: loggerMock as never,
      });

      expect(registeredEvents).toContain("SIGINT");
      expect(registeredEvents).toContain("SIGTERM");
    } finally {
      process.on = origProcessOn;
      process.exit = origExit;
    }
  });

  test("calls dashboard.stop() and orchestrator.stop() on shutdown", async () => {
    const origExit = process.exit;
    const exitCodes: number[] = [];
    process.exit = ((code: number) => { exitCodes.push(code); }) as never;

    let sigintHandler: ((...args: unknown[]) => void) | null = null;
    const origProcessOn = process.on;
    process.on = ((event: string, handler: (...args: unknown[]) => void) => {
      if (event === "SIGINT") sigintHandler = handler;
      return process;
    }) as never;

    try {
      const dashboardMock = { start: mock(() => {}), stop: mock(() => {}) };
      const loggerMock = { info: mock(() => {}) };
      const orchestratorMock = { stop: mock(() => Promise.resolve()) };
      const watcherMock = { stop: mock(() => {}) };
      const tokenStoreMock = { close: mock(() => {}) };

      setupGracefulShutdown({
        orchestrator: orchestratorMock as never,
        watcher: watcherMock as never,
        dashboard: dashboardMock,
        tokenStore: tokenStoreMock as never,
        logger: loggerMock as never,
      });

      // Trigger the handler
      expect(sigintHandler).not.toBeNull();
      await sigintHandler!();

      expect(dashboardMock.stop).toHaveBeenCalled();
      expect(loggerMock.info).toHaveBeenCalledWith("Shutting down...");
      expect(watcherMock.stop).toHaveBeenCalled();
      expect(orchestratorMock.stop).toHaveBeenCalled();
      expect(tokenStoreMock.close).toHaveBeenCalled();
      expect(exitCodes).toEqual([0]);
    } finally {
      process.on = origProcessOn;
      process.exit = origExit;
    }
  });

  test("prevents double-shutdown on rapid signals", async () => {
    const origExit = process.exit;
    const exitCodes: number[] = [];
    process.exit = ((code: number) => { exitCodes.push(code); }) as never;

    let sigintHandler: ((...args: unknown[]) => void) | null = null;
    const origProcessOn = process.on;
    process.on = ((event: string, handler: (...args: unknown[]) => void) => {
      if (event === "SIGINT") sigintHandler = handler;
      return process;
    }) as never;

    try {
      const loggerMock = { info: mock(() => {}) };
      const orchestratorMock = { stop: mock(() => Promise.resolve()) };
      const watcherMock = { stop: mock(() => {}) };
      const tokenStoreMock = { close: mock(() => {}) };

      setupGracefulShutdown({
        orchestrator: orchestratorMock as never,
        watcher: watcherMock as never,
        dashboard: null,
        tokenStore: tokenStoreMock as never,
        logger: loggerMock as never,
      });

      // First call triggers shutdown
      await sigintHandler!();
      // Second call should be a no-op
      await sigintHandler!();

      // orchestrator.stop called only once despite two signals
      expect(orchestratorMock.stop).toHaveBeenCalledTimes(1);
      expect(exitCodes).toEqual([0]);
    } finally {
      process.on = origProcessOn;
      process.exit = origExit;
    }
  });
});
