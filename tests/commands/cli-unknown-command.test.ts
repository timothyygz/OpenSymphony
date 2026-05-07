import { test, describe, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const cliPath = resolve(import.meta.dir, "../../src/cli.ts");

function runCli(args: string[]): { stdout: string; stderr: string; exitCode: number | null } {
  const result = spawnSync("bun", ["run", cliPath, ...args], {
    encoding: "utf-8",
    timeout: 10000,
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status,
  };
}

describe("unknown command handling", () => {
  test("shows help suggestion for unknown command", () => {
    const result = runCli(["foobar"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown command: foobar");
    expect(result.stderr).toContain("opensymphony --help");
    expect(result.stderr).toContain("available commands");
  });

  test("shows help suggestion for another unknown command", () => {
    const result = runCli(["start"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown command: start");
    expect(result.stderr).toContain("opensymphony --help");
  });

  test("does NOT treat file paths as unknown commands", () => {
    // A path with '/' should be treated as a workflow path, not a command
    const result = runCli(["./WORKFLOW.md"]);

    // It should NOT show "Unknown command" — it may fail with "Workflow file not found"
    // but that's a different error
    expect(result.stderr).not.toContain("Unknown command");
  });

  test("does NOT treat dotted names as unknown commands", () => {
    // A name with '.' is likely a file, not a command
    const result = runCli(["WORKFLOW.md"]);

    expect(result.stderr).not.toContain("Unknown command");
  });

  test("valid commands still work (--help)", () => {
    const result = runCli(["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: opensymphony");
  });
});
