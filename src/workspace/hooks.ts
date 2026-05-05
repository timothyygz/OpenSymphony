import type { HooksConfig } from "../model/index.ts";
import { logger } from "../logging/logger.ts";

type HookName = "after_create" | "before_run" | "after_run" | "before_remove";

export async function runHook(
  name: HookName,
  script: string,
  cwd: string,
  timeoutMs: number,
): Promise<void> {
  logger.info({ hook: name, cwd }, "Running workspace hook");

  const proc = Bun.spawn(["bash", "-lc", script], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const timeoutHandle = setTimeout(() => {
    try {
      proc.kill("SIGTERM");
    } catch {
      // already exited
    }
  }, timeoutMs);

  try {
    const exitCode = await proc.exited;
    clearTimeout(timeoutHandle);

    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`Hook ${name} failed (exit ${exitCode}): ${stderr.slice(0, 500)}`);
    }

    logger.debug({ hook: name, exitCode }, "Hook completed");
  } catch (err) {
    clearTimeout(timeoutHandle);
    throw err;
  }
}

export async function runHookIfConfigured(
  name: HookName,
  config: HooksConfig,
  cwd: string,
): Promise<void> {
  const script = config[name];
  if (!script) return;
  return runHook(name, script, cwd, config.timeout_ms);
}

export async function runHookBestEffort(
  name: HookName,
  config: HooksConfig,
  cwd: string,
): Promise<void> {
  try {
    await runHookIfConfigured(name, config, cwd);
  } catch (err) {
    logger.warn({ hook: name, error: String(err) }, "Hook failed (best-effort, ignored)");
  }
}
