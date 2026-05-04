import { watchFile, unwatchFile } from "node:fs";
import { type ServiceConfig } from "../model/index.ts";
import { loadWorkflow, resolveWorkflowPath } from "./loader.ts";
import { buildServiceConfig } from "./config.ts";
import { logger } from "../logging/logger.ts";
import type { WorkflowDefinition } from "../model/index.ts";

const FILE_WATCH_INTERVAL_MS = 1000;
const RELOAD_DEBOUNCE_MS = 300;

export type WorkflowReloadResult =
  | { ok: true; workflow: WorkflowDefinition; config: ServiceConfig }
  | { ok: false; error: string };

export class WorkflowWatcher {
  private watchedPath: string | null = null;
  private lastGoodWorkflow: WorkflowDefinition | null = null;
  private lastGoodConfig: ServiceConfig | null = null;
  private onChange: ((result: WorkflowReloadResult) => void) | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  start(
    explicitPath: string | undefined,
    onChange: (result: WorkflowReloadResult) => void,
  ): WorkflowReloadResult {
    this.onChange = onChange;
    this.watchedPath = resolveWorkflowPath(explicitPath);

    const initial = this.loadAndValidate();
    if (initial.ok) {
      this.lastGoodWorkflow = initial.workflow;
      this.lastGoodConfig = initial.config;
    }

    watchFile(this.watchedPath, { interval: FILE_WATCH_INTERVAL_MS }, () => {
      this.debouncedReload();
    });

    return initial;
  }

  stop(): void {
    if (this.watchedPath) {
      unwatchFile(this.watchedPath);
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
  }

  get currentWorkflow(): WorkflowDefinition | null {
    return this.lastGoodWorkflow;
  }

  get currentConfig(): ServiceConfig | null {
    return this.lastGoodConfig;
  }

  private loadAndValidate(): WorkflowReloadResult {
    try {
      const workflow = loadWorkflow(this.watchedPath!);
      const workflowDir = this.watchedPath!.substring(0, this.watchedPath!.lastIndexOf("/"));
      const config = buildServiceConfig(workflow.config, workflowDir);
      return { ok: true, workflow, config };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private debouncedReload(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      const result = this.loadAndValidate();
      if (result.ok) {
        logger.info("Workflow reloaded successfully");
        this.lastGoodWorkflow = result.workflow;
        this.lastGoodConfig = result.config;
      } else {
        logger.error({ error: result.error }, "Workflow reload failed, keeping last known good config");
      }
      this.onChange?.(result);
    }, RELOAD_DEBOUNCE_MS);
  }
}
