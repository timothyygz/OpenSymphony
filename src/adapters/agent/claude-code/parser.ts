import type { AgentEvent, TokenUsage } from "../types.ts";

export interface StreamJsonEvent {
  type: string;
  [key: string]: unknown;
}

export function parseStreamJsonLine(line: string): AgentEvent | null {
  if (!line.trim()) return null;

  try {
    const parsed = JSON.parse(line) as StreamJsonEvent;
    return mapToAgentEvent(parsed);
  } catch {
    // Not JSON — treat as a message
    return {
      event: "message",
      timestamp: new Date().toISOString(),
      message: line.trim(),
    };
  }
}

function mapToAgentEvent(parsed: StreamJsonEvent): AgentEvent {
  const event: AgentEvent = {
    event: parsed.type ?? "unknown",
    timestamp: new Date().toISOString(),
    message: extractMessage(parsed),
    usage: extractUsage(parsed),
  };
  return event;
}

function extractMessage(parsed: StreamJsonEvent): string | undefined {
  if (typeof parsed.message === "string") return parsed.message;
  if (typeof parsed.content === "string") return parsed.content;
  if (typeof parsed.text === "string") return parsed.text;
  if (parsed.result && typeof parsed.result === "string") return parsed.result;
  return undefined;
}

function extractUsage(parsed: StreamJsonEvent): TokenUsage | undefined {
  const usage = parsed.usage ?? parsed.tokenUsage;
  if (!usage || typeof usage !== "object") return undefined;

  const u = usage as Record<string, unknown>;
  return {
    inputTokens: typeof u.inputTokens === "number" ? u.inputTokens : (typeof u.input_tokens === "number" ? u.input_tokens : 0),
    outputTokens: typeof u.outputTokens === "number" ? u.outputTokens : (typeof u.output_tokens === "number" ? u.output_tokens : 0),
    totalTokens: typeof u.totalTokens === "number" ? u.totalTokens : (typeof u.total_tokens === "number" ? u.total_tokens : 0),
  };
}
