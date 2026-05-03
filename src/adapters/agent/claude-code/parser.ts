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
    rawEvent: parsed as unknown as import("../types.ts").ClaudeStreamEvent,
    toolName: extractToolName(parsed),
    toolInput: extractToolInput(parsed),
    sessionId: typeof parsed.session_id === "string" ? parsed.session_id : undefined,
  };
  return event;
}

function extractToolName(parsed: StreamJsonEvent): string | undefined {
  if (typeof parsed.tool_name === "string") return parsed.tool_name;
  const msg = parsed.message;
  if (msg && typeof msg === "object" && "content" in msg && Array.isArray(msg.content)) {
    for (const block of msg.content) {
      if (typeof block === "object" && block !== null && "name" in block) {
        return String((block as Record<string, unknown>).name);
      }
    }
  }
  return undefined;
}

function extractToolInput(parsed: StreamJsonEvent): unknown {
  if (parsed.tool_input !== undefined) return parsed.tool_input;
  const msg = parsed.message;
  if (msg && typeof msg === "object" && "content" in msg && Array.isArray(msg.content)) {
    for (const block of msg.content) {
      if (typeof block === "object" && block !== null && "input" in block) {
        return (block as Record<string, unknown>).input;
      }
    }
  }
  return undefined;
}

function extractMessage(parsed: StreamJsonEvent): string | undefined {
  if (typeof parsed.message === "string") return parsed.message;
  if (typeof parsed.content === "string") return parsed.content;
  if (typeof parsed.text === "string") return parsed.text;
  if (parsed.result && typeof parsed.result === "string") return parsed.result;
  return undefined;
}

function extractUsage(parsed: StreamJsonEvent): TokenUsage | undefined {
  const raw = parsed.usage ?? parsed.tokenUsage ?? parsed.modelUsage;
  if (!raw || typeof raw !== "object") return undefined;

  // modelUsage is keyed by model name, e.g. { "glm-5.1": { inputTokens, ... } }
  const u = (typeof (raw as Record<string, unknown>).modelUsage === "object")
    ? ((raw as Record<string, Record<string, unknown>>).modelUsage as Record<string, Record<string, unknown>>)
    : (raw as Record<string, unknown>);

  // If still keyed by model name, take first entry
  const src = ("inputTokens" in u || "input_tokens" in u)
    ? u
    : Object.values(u)[0] as Record<string, unknown> | undefined;
  if (!src) return undefined;

  const inputTokens = typeof src.inputTokens === "number" ? src.inputTokens : (typeof src.input_tokens === "number" ? src.input_tokens : 0);
  const outputTokens = typeof src.outputTokens === "number" ? src.outputTokens : (typeof src.output_tokens === "number" ? src.output_tokens : 0);
  const totalTokens = typeof src.totalTokens === "number" ? src.totalTokens : (typeof src.total_tokens === "number" ? src.total_tokens : inputTokens + outputTokens);

  if (inputTokens === 0 && outputTokens === 0) return undefined;

  return { inputTokens, outputTokens, totalTokens };
}
