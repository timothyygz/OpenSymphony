import { appendFile } from "node:fs/promises";
import { logger } from "../logging/logger.ts";

export interface TokenRecord {
  identifier: string;
  issueId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  turns: number;
  retryAttempt: number;
  completedAt: string;
}

export class TokenLog {
  constructor(private readonly filePath: string) {}

  async append(record: TokenRecord): Promise<void> {
    try {
      const line = JSON.stringify(record) + "\n";
      await appendFile(this.filePath, line, "utf-8");
    } catch (err) {
      logger.warn({ error: String(err) }, "Token log write failed");
    }
  }

  async summary(): Promise<{ totalInput: number; totalOutput: number; totalTokens: number; issueCount: number }> {
    let totalInput = 0;
    let totalOutput = 0;
    let totalTokens = 0;
    let issueCount = 0;

    const file = Bun.file(this.filePath);
    if (!(await file.exists())) {
      return { totalInput: 0, totalOutput: 0, totalTokens: 0, issueCount: 0 };
    }

    const text = await file.text();
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const r = JSON.parse(trimmed) as TokenRecord;
        totalInput += r.inputTokens;
        totalOutput += r.outputTokens;
        totalTokens += r.totalTokens;
        issueCount++;
      } catch {
        logger.warn({ line: trimmed.slice(0, 100) }, "Skipping corrupted token log line");
      }
    }

    return { totalInput, totalOutput, totalTokens, issueCount };
  }
}
