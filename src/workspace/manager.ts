import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import type { Workspace } from "../model/index.ts";
import type { WorkspaceSource } from "../model/workflow.ts";
import { sanitizeKey, validateContainment, expandPath } from "./safety.ts";
import { runHookIfConfigured, runHookBestEffort, type HooksConfig } from "./hooks.ts";
import { initSources, cleanupSources } from "./sources.ts";
import { writeMetaJson, readMetaJson } from "../logging/turn-log.ts";
import { WorkspaceSafetyError, WorkspaceCreationError } from "../errors/errors.ts";
import { logger } from "../logging/logger.ts";

export interface WorkspaceManagerConfig {
  root: string;
  hooks: HooksConfig;
  sources: WorkspaceSource[];
  workflowDir: string;
}

export class WorkspaceManager {
  constructor(private readonly config: WorkspaceManagerConfig) {}

  async createForIssue(identifier: string): Promise<Workspace> {
    const workspaceKey = sanitizeKey(identifier);
    const workspacePath = resolve(this.config.root, workspaceKey);

    if (!validateContainment(workspacePath, this.config.root)) {
      throw new WorkspaceSafetyError(`Workspace path escapes root: ${workspacePath}`);
    }

    const existed = existsSync(workspacePath);
    let createdNow = false;

    if (!existed) {
      try {
        const { mkdir } = await import("node:fs/promises");
        await mkdir(workspacePath, { recursive: true });
        createdNow = true;
        logger.info({ workspaceKey, workspacePath }, "Workspace created");
      } catch (err) {
        throw new WorkspaceCreationError(`Failed to create workspace: ${err}`);
      }
    }

    const workspace: Workspace = { path: workspacePath, workspaceKey, createdNow };

    if (createdNow) {
      try {
        // Initialize sources (git clone / worktree) before hooks
        if (this.config.sources.length > 0) {
          await initSources(this.config.sources, workspacePath, this.config.workflowDir, identifier);
        }

        // Run after_create hook
        await runHookIfConfigured("after_create", this.config.hooks, workspacePath);
      } catch (err) {
        // Clean up partially created workspace on failure
        try { rmSync(workspacePath, { recursive: true, force: true }); } catch {}
        throw new WorkspaceCreationError(`Workspace initialization failed: ${err}`);
      }
    } else {
      // Warn if sources config has changed since creation
      try {
        const meta = readMetaJson(workspacePath);
        if (meta?.sourcesHash) {
          const currentHash = hashSources(this.config.sources);
          if (currentHash !== meta.sourcesHash) {
            logger.warn({ identifier, workspaceKey }, "Sources config has changed since workspace creation");
          }
        }
      } catch {
        // meta.json may not exist for pre-existing workspaces
      }
    }

    return workspace;
  }

  async cleanupWorkspace(identifier: string): Promise<void> {
    const workspaceKey = sanitizeKey(identifier);
    const workspacePath = resolve(this.config.root, workspaceKey);

    if (!validateContainment(workspacePath, this.config.root)) return;
    if (!existsSync(workspacePath)) return;

    await runHookBestEffort("before_remove", this.config.hooks, workspacePath);

    // Cleanup worktree sources using meta.json snapshot
    try {
      const meta = readMetaJson(workspacePath);
      if (meta?.sources && Array.isArray(meta.sources)) {
        await cleanupSources(meta.sources, workspacePath);
      }
    } catch {
      // meta.json may not exist
    }

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

export function hashSources(sources: WorkspaceSource[]): string {
  return createHash("sha256").update(JSON.stringify(sources)).digest("hex").slice(0, 16);
}
