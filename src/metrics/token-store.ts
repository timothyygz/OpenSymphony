import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { logger } from "../logging/logger.ts";
import type { HistoryStats, PeriodStats } from "../model/session.ts";

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

const EMPTY_STATS: PeriodStats = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  issueCount: 0,
};

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS token_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    identifier TEXT NOT NULL,
    issue_id TEXT NOT NULL,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    total_tokens INTEGER NOT NULL,
    turns INTEGER NOT NULL,
    retry_attempt INTEGER NOT NULL,
    completed_at TEXT NOT NULL
  )
`;

const INSERT_SQL = `
  INSERT INTO token_records (identifier, issue_id, input_tokens, output_tokens, total_tokens, turns, retry_attempt, completed_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`;

const AGGREGATE_SQL = `
  SELECT
    COALESCE(SUM(input_tokens), 0) as input_tokens,
    COALESCE(SUM(output_tokens), 0) as output_tokens,
    COALESCE(SUM(total_tokens), 0) as total_tokens,
    COUNT(*) as issue_count
  FROM token_records
  WHERE completed_at >= ?
`;

export class TokenStore {
  private readonly db: Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA journal_mode=WAL");
    this.db.exec(CREATE_TABLE_SQL);
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_token_records_completed_at ON token_records(completed_at)");
  }

  append(record: TokenRecord): void {
    try {
      this.db.run(INSERT_SQL, [
        record.identifier,
        record.issueId,
        record.inputTokens,
        record.outputTokens,
        record.totalTokens,
        record.turns,
        record.retryAttempt,
        record.completedAt,
      ]);
    } catch (err) {
      logger.warn({ error: String(err), record }, "Failed to write token record to SQLite");
    }
  }

  aggregate(): HistoryStats {
    const now = new Date();
    const dayStart = startOfDay(now).toISOString();
    const weekStart = startOfWeek(now).toISOString();
    const monthStart = startOfMonth(now).toISOString();

    return {
      today: this.queryPeriod(dayStart),
      week: this.queryPeriod(weekStart),
      month: this.queryPeriod(monthStart),
    };
  }

  private queryPeriod(since: string): PeriodStats {
    const row = this.db.query<{
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
      issue_count: number;
    }, [string]>(AGGREGATE_SQL).get(since);

    if (!row) return { ...EMPTY_STATS };

    return {
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      totalTokens: row.total_tokens,
      issueCount: row.issue_count,
    };
  }

  close(): void {
    this.db.close();
  }
}

function startOfDay(d: Date): Date {
  const result = new Date(d);
  result.setHours(0, 0, 0, 0);
  return result;
}

function startOfWeek(d: Date): Date {
  const result = startOfDay(d);
  const day = result.getDay();
  const diff = day === 0 ? 6 : day - 1;
  result.setDate(result.getDate() - diff);
  return result;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
