import { test, expect, describe } from "bun:test";
import { humanizeEvent, dotColor, formatRateLimits } from "../../src/tui/events.ts";

describe("humanizeEvent", () => {
  const knownEvents: Array<[string, string]> = [
    ["system", "session initialized"],
    ["assistant", "thinking..."],
    ["content_block_start", "generating response"],
    ["content_block_delta", "streaming output"],
    ["content_block_stop", "response complete"],
    ["result", "turn completed"],
    ["tool_use", "tool call"],
    ["tool_result", "tool result received"],
    ["message", "text output"],
  ];

  for (const [event, expected] of knownEvents) {
    test(`maps "${event}" to "${expected}"`, () => {
      expect(humanizeEvent(event).text).toBe(expected);
    });
  }

  test("returns raw name for unknown event", () => {
    expect(humanizeEvent("custom_event_xyz").text).toBe("custom_event_xyz");
  });

  test("returns 'none' for null event", () => {
    expect(humanizeEvent(null).text).toBe("none");
  });

  test("all known events return a color", () => {
    for (const [event] of knownEvents) {
      const color = humanizeEvent(event).color;
      expect(color).toBeTruthy();
    }
  });
});

describe("dotColor", () => {
  test("returns red for null event", () => {
    expect(dotColor(null)).toBe("red");
  });

  test("returns yellow for unknown event", () => {
    expect(dotColor("unknown_event")).toBe("yellow");
  });

  test("returns specific color for known events", () => {
    expect(dotColor("content_block_start")).toBe("green");
    expect(dotColor("result")).toBe("magenta");
  });
});

describe("formatRateLimits", () => {
  test("returns N/A for null", () => {
    expect(formatRateLimits(null)).toBe("N/A");
  });

  test("returns N/A for undefined", () => {
    expect(formatRateLimits(undefined)).toBe("N/A");
  });

  test("returns N/A for non-object", () => {
    expect(formatRateLimits("string")).toBe("N/A");
  });

  test("returns N/A for empty object", () => {
    expect(formatRateLimits({})).toBe("N/A");
  });

  test("formats primary remaining/limit", () => {
    expect(formatRateLimits({ primary: { remaining: 50, limit: 60 } })).toBe("50/60");
  });

  test("formats remaining only", () => {
    expect(formatRateLimits({ primary: { remaining: 50 } })).toBe("remaining 50");
  });
});
