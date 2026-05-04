import { logger } from "../logging/logger.ts";
import type { HistoryStats, PeriodStats } from "../model/session.ts";

const EMPTY_STATS: PeriodStats = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  issueCount: 0,
};

interface ParsedRecord {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  completedAt: string;
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

function parseLine(line: string): ParsedRecord | null {
  try {
    const r = JSON.parse(line);
    // Only parse token_usage events from symphony.log
    if (r.event !== "token_usage") return null;
    if (typeof r.completedAt !== "string") return null;
    return {
      inputTokens: Number(r.inputTokens) || 0,
      outputTokens: Number(r.outputTokens) || 0,
      totalTokens: Number(r.totalTokens) || 0,
      completedAt: r.completedAt,
    };
  } catch {
    return null;
  }
}

export async function aggregate(filePath: string): Promise<HistoryStats> {
  const today = new Date();
  const dayStart = startOfDay(today).getTime();
  const weekStart = startOfWeek(today).getTime();
  const monthStart = startOfMonth(today).getTime();

  const todayStats: PeriodStats = { ...EMPTY_STATS };
  const weekStats: PeriodStats = { ...EMPTY_STATS };
  const monthStats: PeriodStats = { ...EMPTY_STATS };

  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    return { today: todayStats, week: weekStats, month: monthStats };
  }

  const text = await file.text();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const r = parseLine(trimmed);
    if (!r) continue;

    const ts = new Date(r.completedAt).getTime();
    if (isNaN(ts)) {
      logger.warn({ line: trimmed.slice(0, 100) }, "Skipping record with invalid completedAt");
      continue;
    }

    const add = (stats: PeriodStats) => {
      stats.inputTokens += r.inputTokens;
      stats.outputTokens += r.outputTokens;
      stats.totalTokens += r.totalTokens;
      stats.issueCount++;
    };

    if (ts >= monthStart) add(monthStats);
    if (ts >= weekStart) add(weekStats);
    if (ts >= dayStart) add(todayStats);
  }

  return { today: todayStats, week: weekStats, month: monthStats };
}
