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

const DOT_COLORS: Record<string, string> = {
  system:               "gray",
  assistant:            "blue",
  content_block_start:  "green",
  content_block_delta:  "cyan",
  content_block_stop:   "green",
  result:               "magenta",
  tool_use:             "yellow",
  tool_result:          "cyan",
  message:              "gray",
};

export function humanizeEvent(eventName: string | null): EventMapping {
  if (!eventName) return { text: "none", color: "red" };
  return EVENT_MAP[eventName] ?? { text: eventName, color: "yellow" };
}

export function dotColor(eventName: string | null): string {
  if (!eventName) return "red";
  return DOT_COLORS[eventName] ?? "yellow";
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
