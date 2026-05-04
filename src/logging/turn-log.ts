import { existsSync, mkdirSync } from "node:fs";
import { appendFile, writeFile, readFile, access } from "node:fs/promises";
import { resolve } from "node:path";
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

  async append(entry: TurnLogEntry): Promise<void> {
    try {
      const line = JSON.stringify(entry) + "\n";
      await appendFile(this.logPath(), line, "utf-8");
    } catch (err) {
      logger.warn({ error: String(err) }, "Turn log write failed");
    }
  }

  async logUserPrompt(turn: number, content: string): Promise<void> {
    await this.append({ turn, role: "user", content, timestamp: new Date().toISOString() });
  }

  async logAssistantMessage(turn: number, content: string): Promise<void> {
    await this.append({ turn, role: "assistant", content, timestamp: new Date().toISOString() });
  }

  async logToolUse(turn: number, tool: string, input: unknown): Promise<void> {
    await this.append({ turn, role: "tool_use", tool, input, timestamp: new Date().toISOString() });
  }

  async logToolResult(turn: number, tool: string, output: string): Promise<void> {
    const truncated = output.length > MAX_TOOL_OUTPUT
      ? output.slice(0, MAX_TOOL_OUTPUT) + "...[truncated]"
      : output;
    await this.append({ turn, role: "tool_result", tool, output: truncated, timestamp: new Date().toISOString() });
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

export async function writeMetaJson(workspacePath: string, meta: SessionMeta): Promise<void> {
  const filePath = resolve(workspacePath, SYMPHONY_DIR, META_FILE);
  try {
    await writeFile(filePath, JSON.stringify(meta, null, 2), "utf-8");
  } catch (err) {
    logger.warn({ error: String(err) }, "meta.json write failed");
  }
}

export async function updateMetaJson(workspacePath: string, updates: Partial<SessionMeta>): Promise<void> {
  const current = await readMetaJson(workspacePath);
  if (!current) return;
  await writeMetaJson(workspacePath, { ...current, ...updates });
}

export async function readMetaJson(workspacePath: string): Promise<SessionMeta | null> {
  const filePath = resolve(workspacePath, SYMPHONY_DIR, META_FILE);
  try {
    await access(filePath);
    const content = await readFile(filePath, "utf-8");
    return JSON.parse(content) as SessionMeta;
  } catch {
    return null;
  }
}
