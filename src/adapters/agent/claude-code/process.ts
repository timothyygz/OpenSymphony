import type { Subprocess } from "bun";
import { logger } from "../../../logging/logger.ts";
import { parseStreamJsonLine } from "./parser.ts";
import type { AgentEvent, TurnResult } from "../types.ts";

export interface RunProcessOptions {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  onEvent: (event: AgentEvent) => void;
}

export async function runClaudeProcess(opts: RunProcessOptions): Promise<TurnResult> {
  const { command, args, cwd, timeoutMs, onEvent } = opts;

  let proc: Subprocess<"pipe", "pipe", "pipe">;
  try {
    proc = Bun.spawn([command, ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (err) {
    return { status: "failed", error: `Failed to spawn ${command}: ${err}` };
  }

  const pid = proc.pid;
  logger.debug({ pid, args, cwd }, "Claude process spawned");

  // Set up timeout
  let timedOut = false;
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    try {
      proc.kill("SIGTERM");
      logger.warn({ pid, timeoutMs }, "Claude process timed out, sending SIGTERM");
    } catch {
      // Process may have already exited
    }
  }, timeoutMs);

  // Stream stdout
  try {
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const event = parseStreamJsonLine(line);
        if (event) onEvent(event);
      }
    }
    // Process remaining buffer
    if (buffer.trim()) {
      const event = parseStreamJsonLine(buffer);
      if (event) onEvent(event);
    }
  } catch (err) {
    logger.debug({ pid, error: String(err) }, "stdout read ended");
  }

  const exitCode = await proc.exited;
  clearTimeout(timeoutHandle);

  if (timedOut) {
    return { status: "timed_out", error: `Turn timed out after ${timeoutMs}ms` };
  }

  if (exitCode !== 0) {
    return { status: "failed", error: `Process exited with code ${exitCode}` };
  }

  return { status: "completed" };
}
