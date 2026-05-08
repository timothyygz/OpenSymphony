import type { TrackerAdapter, TrackerAdapterFactory } from "./types.ts";
import type { TrackerSetupFn } from "../../setup/types.ts";
import { logger } from "../../logging/logger.ts";

interface TrackerEntry {
  factory: TrackerAdapterFactory;
  setupFn?: TrackerSetupFn;
}

const trackers = new Map<string, TrackerEntry>();

export function registerTracker(kind: string, factory: TrackerAdapterFactory, setupFn?: TrackerSetupFn): void {
  trackers.set(kind, { factory, setupFn });
  logger.debug({ kind }, "Tracker adapter registered");
}

export function createTracker(kind: string, config: Record<string, unknown>): TrackerAdapter {
  const entry = trackers.get(kind);
  if (!entry) {
    throw new Error(`Unknown tracker adapter: ${kind}. Available: ${[...trackers.keys()].join(", ")}`);
  }
  return entry.factory(config);
}

export function getTrackerSetup(kind: string): TrackerSetupFn | undefined {
  return trackers.get(kind)?.setupFn;
}

export function availableTrackerKinds(): string[] {
  return [...trackers.keys()];
}
