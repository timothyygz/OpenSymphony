import type { WorkspaceSource } from "../model/workflow.ts";
import { expandPath, sanitizeKey } from "./safety.ts";
import { logger } from "../logging/logger.ts";

const SPAWN_TIMEOUT_MS = 120_000;

export async function initSources(
  sources: WorkspaceSource[],
  workspacePath: string,
  workflowDir: string,
  identifier?: string,
): Promise<void> {
  const completed: { source: WorkspaceSource; subPath: string }[] = [];

  for (const source of sources) {
    try {
      const subPath = getSubPath(source);
      switch (source.type) {
        case "git-clone":
          await cloneSource(source, workspacePath, subPath);
          break;
        case "git-worktree":
          await addWorktree(source, workspacePath, subPath, workflowDir, identifier);
          break;
      }
      completed.push({ source, subPath });
    } catch (err) {
      // Rollback already-completed sources
      logger.error({ source, error: String(err) }, "Source initialization failed, rolling back");
      await rollbackSources(completed, workspacePath);
      throw err;
    }
  }
}

export async function cleanupSources(
  sources: WorkspaceSource[],
  workspacePath: string,
): Promise<void> {
  for (const source of [...sources].reverse()) {
    if (source.type !== "git-worktree") continue;

    const subPath = getSubPath(source);
    const fullPath = `${workspacePath}/${subPath}`;

    try {
      const repoPath = source.repo;
      await exec("git", ["-C", repoPath, "worktree", "remove", fullPath, "--force"]);
      logger.info({ repo: repoPath, worktree: fullPath }, "Worktree removed");
    } catch (err) {
      logger.warn({ source, error: String(err) }, "Worktree remove failed, will fallback to rm -rf");
    }
  }
}

function getSubPath(source: WorkspaceSource): string {
  if (source.path) return source.path;
  if (source.type === "git-worktree") {
    // Default to repo directory name
    const parts = source.repo.replace(/\/+$/, "").split("/");
    return parts[parts.length - 1] || "repo";
  }
  return "repo";
}

async function cloneSource(
  source: Extract<WorkspaceSource, { type: "git-clone" }>,
  workspacePath: string,
  subPath: string,
): Promise<void> {
  const args = ["clone"];
  if (source.depth && source.depth > 0) {
    args.push("--depth", String(source.depth));
  }
  if (source.branch) {
    args.push("--branch", source.branch);
  }
  args.push(source.url, `${workspacePath}/${subPath}`);

  logger.info({ url: source.url, path: subPath, branch: source.branch }, "Cloning repository");
  await exec("git", args);
}

async function addWorktree(
  source: Extract<WorkspaceSource, { type: "git-worktree" }>,
  workspacePath: string,
  subPath: string,
  workflowDir: string,
  identifier?: string,
): Promise<void> {
  const repoPath = expandPath(source.repo, workflowDir);
  const args = ["-C", repoPath, "worktree", "add", `${workspacePath}/${subPath}`];

  const branch = source.branch ?? (identifier ? sanitizeKey(identifier) : undefined);

  if (branch) {
    args.push("-b", branch);
  } else {
    args.push("--detach", "HEAD");
  }

  logger.info({ repo: repoPath, path: subPath, branch }, "Adding worktree");
  await exec("git", args);
}

async function rollbackSources(
  completed: { source: WorkspaceSource; subPath: string }[],
  workspacePath: string,
): Promise<void> {
  for (const { source, subPath } of [...completed].reverse()) {
    try {
      if (source.type === "git-worktree") {
        const repoPath = expandPath(source.repo);
        await exec("git", ["-C", repoPath, "worktree", "remove", `${workspacePath}/${subPath}`, "--force"]);
      } else {
        await exec("rm", ["-rf", `${workspacePath}/${subPath}`]);
      }
    } catch (err) {
      logger.warn({ source, error: String(err) }, "Rollback failed for source");
    }
  }
}

function exec(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = Bun.spawn([command, ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const timeout = setTimeout(() => {
      try { proc.kill("SIGTERM"); } catch {}
    }, SPAWN_TIMEOUT_MS);

    proc.exited.then((code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
      }
    }).catch(reject);
  });
}
