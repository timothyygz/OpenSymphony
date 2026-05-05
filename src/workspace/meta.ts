import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { logger } from "../logging/logger.ts";
import type { WorkspaceSource } from "../model/workflow.ts";

export const SYMPHONY_DIR = ".symphony";
export const META_FILE = "meta.json";

export interface SessionMeta {
  issueId: string;
  identifier: string;
  title: string;
  workspacePath: string;
  sessionId: string | null;
  startedAt: string;
  lastTurnAt?: string;
  totalTurns: number;
  totalTokens: number;
  sources?: WorkspaceSource[];
  sourcesHash?: string;
}

export function ensureSymphonyDir(workspacePath: string): string {
  const dir = resolve(workspacePath, SYMPHONY_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function writeMetaJson(workspacePath: string, meta: SessionMeta): void {
  ensureSymphonyDir(workspacePath);
  const filePath = resolve(workspacePath, SYMPHONY_DIR, META_FILE);
  try {
    writeFileSync(filePath, JSON.stringify(meta, null, 2), "utf-8");
  } catch (err) {
    logger.warn({ error: String(err) }, "meta.json write failed");
  }
}

export function updateMetaJson(workspacePath: string, updates: Partial<SessionMeta>): void {
  const current = readMetaJson(workspacePath);
  if (!current) return;
  writeMetaJson(workspacePath, { ...current, ...updates });
}

export function readMetaJson(workspacePath: string): SessionMeta | null {
  const filePath = resolve(workspacePath, SYMPHONY_DIR, META_FILE);
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, "utf-8")) as SessionMeta;
  } catch {
    return null;
  }
}
