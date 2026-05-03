import type { AgentAdapter, AgentAdapterFactory } from "./types.ts";
import { logger } from "../../logging/logger.ts";

const agents = new Map<string, AgentAdapterFactory>();

export function registerAgent(kind: string, factory: AgentAdapterFactory): void {
  agents.set(kind, factory);
  logger.debug({ kind }, "Agent adapter registered");
}

export function createAgent(kind: string, config: Record<string, unknown>): AgentAdapter {
  const factory = agents.get(kind);
  if (!factory) {
    throw new Error(`Unknown agent adapter: ${kind}. Available: ${[...agents.keys()].join(", ")}`);
  }
  return factory(config);
}

export function availableAgentKinds(): string[] {
  return [...agents.keys()];
}
