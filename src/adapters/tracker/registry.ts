import type { TrackerAdapter, TrackerAdapterFactory } from "./types.ts";
import type { TrackerSetupFn } from "../../setup/types.ts";
import { logger } from "../../logging/logger.ts";

export interface TrackerMeta {
  /** Display label shown in selection UI */
  label: string;
  /** One-line description of the tracker */
  description: string;
  /** Whether this is the recommended default */
  recommended?: boolean;
  /** Category for grouping (e.g., "feishu", "git-hosting") */
  category?: string;
}

export type TrackerValidateFn = (config: Record<string, unknown>) => string | null;

interface TrackerEntry {
  factory: TrackerAdapterFactory;
  setupFn?: TrackerSetupFn;
  meta?: TrackerMeta;
  validateFn?: TrackerValidateFn;
}

const trackers = new Map<string, TrackerEntry>();

export function registerTracker(
  kind: string,
  factory: TrackerAdapterFactory,
  setupFn?: TrackerSetupFn,
  meta?: TrackerMeta,
  validateFn?: TrackerValidateFn,
): void {
  trackers.set(kind, { factory, setupFn, meta, validateFn });
  logger.debug({ kind }, "Tracker adapter registered");
}

export function createTracker(kind: string, config: Record<string, unknown>): TrackerAdapter {
  const entry = trackers.get(kind);
  if (!entry) {
    throw new Error(`Unknown tracker adapter: ${kind}. Available: ${[...trackers.keys()].join(", ")}`);
  }
  return entry.factory(config);
}

export function validateTrackerConfig(kind: string, config: Record<string, unknown>): string | null {
  const entry = trackers.get(kind);
  if (!entry?.validateFn) return null;
  return entry.validateFn(config);
}

export function getTrackerSetup(kind: string): TrackerSetupFn | undefined {
  return trackers.get(kind)?.setupFn;
}

export function getTrackerMeta(kind: string): TrackerMeta | undefined {
  return trackers.get(kind)?.meta;
}

export function availableTrackerKinds(): string[] {
  return [...trackers.keys()];
}
