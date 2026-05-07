interface EventMapping {
  text: string;
  color: string;
}

const EVENT_MAP: Record<string, EventMapping> = {
  system:               { text: "session initialized",  color: "gray" },
  assistant:            { text: "thinking...",           color: "blue" },
  content_block_start:  { text: "generating response",  color: "green" },
  content_block_delta:  { text: "streaming output",     color: "cyan" },
  content_block_stop:   { text: "response complete",    color: "green" },
  result:               { text: "turn completed",       color: "magenta" },
  tool_use:             { text: "tool call",            color: "yellow" },
  tool_result:          { text: "tool result received", color: "cyan" },
  message:              { text: "text output",          color: "gray" },
};

const DEFAULT_EVENT: EventMapping = { text: "none", color: "red" };
const UNKNOWN_EVENT: EventMapping = { text: "", color: "yellow" };

export function humanizeEvent(eventName: string | null): EventMapping {
  if (!eventName) return DEFAULT_EVENT;
  const mapping = EVENT_MAP[eventName];
  if (!mapping) return { ...UNKNOWN_EVENT, text: eventName };
  return mapping;
}

export function dotColor(eventName: string | null): string {
  return humanizeEvent(eventName).color;
}

export function formatRateLimits(rateLimits: unknown): string {
  if (!rateLimits || typeof rateLimits !== "object") return "N/A";
  const r = rateLimits as Record<string, unknown>;

  const primary = r.primary as Record<string, unknown> | undefined;
  const remaining = primary?.remaining;
  const limit = primary?.limit;

  if (typeof remaining === "number" && typeof limit === "number") {
    return `${remaining}/${limit}`;
  }
  if (typeof remaining === "number") {
    return `remaining ${remaining}`;
  }
  return "N/A";
}
