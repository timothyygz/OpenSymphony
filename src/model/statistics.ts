export interface AggregateTotals {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  secondsRunning: number;
}

export interface PeriodStats {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  issueCount: number;
}

export interface HistoryStats {
  today: PeriodStats;
  week: PeriodStats;
  month: PeriodStats;
}
