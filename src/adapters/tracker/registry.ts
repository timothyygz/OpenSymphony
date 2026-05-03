import type { TrackerAdapter, TrackerAdapterFactory } from "./types.ts";
import { logger } from "../../logging/logger.ts";

const trackers = new Map<string, TrackerAdapterFactory>();

export function registerTracker(kind: string, factory: TrackerAdapterFactory): void {
  trackers.set(kind, factory);
  logger.debug({ kind }, "Tracker adapter registered");
}

export function createTracker(kind: string, config: Record<string, unknown>): TrackerAdapter {
  const factory = trackers.get(kind);
  if (!factory) {
    throw new Error(`Unknown tracker adapter: ${kind}. Available: ${[...trackers.keys()].join(", ")}`);
  }
  return factory(config);
}

export function availableTrackerKinds(): string[] {
  return [...trackers.keys()];
}
