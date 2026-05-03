import { mkdirSync, existsSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import type { Workspace } from "../model/index.ts";
import { sanitizeKey, validateContainment } from "./safety.ts";
import { runHookIfConfigured, runHookBestEffort, type HooksConfig } from "./hooks.ts";
import { WorkspaceSafetyError, WorkspaceCreationError } from "../errors/errors.ts";
import { logger } from "../logging/logger.ts";

export interface WorkspaceManagerConfig {
  root: string;
  hooks: HooksConfig;
}

export class WorkspaceManager {
  constructor(private readonly config: WorkspaceManagerConfig) {}

  createForIssue(identifier: string): Workspace {
    const workspaceKey = sanitizeKey(identifier);
    const workspacePath = resolve(this.config.root, workspaceKey);

    if (!validateContainment(workspacePath, this.config.root)) {
      throw new WorkspaceSafetyError(`Workspace path escapes root: ${workspacePath}`);
    }

    const existed = existsSync(workspacePath);
    let createdNow = false;

    if (!existed) {
      try {
        mkdirSync(workspacePath, { recursive: true });
        createdNow = true;
        logger.info({ workspaceKey, workspacePath }, "Workspace created");
      } catch (err) {
        throw new WorkspaceCreationError(`Failed to create workspace: ${err}`);
      }
    }

    const workspace: Workspace = { path: workspacePath, workspaceKey, createdNow };

    if (createdNow) {
      runHookIfConfigured("after_create", this.config.hooks, workspacePath)
        .catch((err) => {
          // Clean up partially created workspace on hook failure
          try {
            rmSync(workspacePath, { recursive: true, force: true });
          } catch {
            // Best effort cleanup
          }
          throw new WorkspaceCreationError(`after_create hook failed: ${err}`);
        });
    }

    return workspace;
  }

  async cleanupWorkspace(identifier: string): Promise<void> {
    const workspaceKey = sanitizeKey(identifier);
    const workspacePath = resolve(this.config.root, workspaceKey);

    if (!validateContainment(workspacePath, this.config.root)) return;
    if (!existsSync(workspacePath)) return;

    await runHookBestEffort("before_remove", this.config.hooks, workspacePath);

    try {
      rmSync(workspacePath, { recursive: true, force: true });
      logger.info({ workspaceKey }, "Workspace cleaned up");
    } catch (err) {
      logger.warn({ workspaceKey, error: String(err) }, "Failed to clean workspace");
    }
  }

  async cleanupTerminalWorkspaces(identifiers: string[]): Promise<void> {
    for (const identifier of identifiers) {
      await this.cleanupWorkspace(identifier);
    }
  }
}
