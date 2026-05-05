import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { logger } from "./logger.ts";
import type { WorkspaceSource } from "../model/workflow.ts";

export const SYMPHONY_DIR = ".symphony";
export const TURNS_FILE = "turns.jsonl";
export const META_FILE = "meta.json";
const MAX_TOOL_OUTPUT = 10000;

export interface TurnLogEntry {
  turn: number;
  role: "user" | "assistant" | "tool_use" | "tool_result";
  content?: string;
  tool?: string;
  input?: unknown;
  output?: string;
  timestamp: string;
}

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

export class TurnLog {
  constructor(private readonly workspacePath: string) {
    ensureSymphonyDir(workspacePath);
  }

  append(entry: TurnLogEntry): void {
    try {
      const line = JSON.stringify(entry) + "\n";
      appendFileSync(this.logPath(), line, "utf-8");
    } catch (err) {
      logger.warn({ error: String(err) }, "Turn log write failed");
    }
  }

  logUserPrompt(turn: number, content: string): void {
    this.append({ turn, role: "user", content, timestamp: new Date().toISOString() });
  }

  logAssistantMessage(turn: number, content: string): void {
    this.append({ turn, role: "assistant", content, timestamp: new Date().toISOString() });
  }

  logToolUse(turn: number, tool: string, input: unknown): void {
    this.append({ turn, role: "tool_use", tool, input, timestamp: new Date().toISOString() });
  }

  logToolResult(turn: number, tool: string, output: string): void {
    const truncated = output.length > MAX_TOOL_OUTPUT
      ? output.slice(0, MAX_TOOL_OUTPUT) + "...[truncated]"
      : output;
    this.append({ turn, role: "tool_result", tool, output: truncated, timestamp: new Date().toISOString() });
  }

  private logPath(): string {
    return resolve(this.workspacePath, SYMPHONY_DIR, TURNS_FILE);
  }
}

export function ensureSymphonyDir(workspacePath: string): string {
  const dir = resolve(workspacePath, SYMPHONY_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function writeMetaJson(workspacePath: string, meta: SessionMeta): void {
  const dir = ensureSymphonyDir(workspacePath);
  const filePath = join(dir, META_FILE);
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
