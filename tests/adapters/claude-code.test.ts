import { describe, test, expect } from "bun:test";
import { parseStreamJsonLine } from "../../src/adapters/agent/claude-code/parser.ts";
import { ClaudeCodeAdapter } from "../../src/adapters/agent/claude-code/adapter.ts";

describe("parseStreamJsonLine", () => {
  test("parses valid JSON event", () => {
    const event = parseStreamJsonLine('{"type":"message","content":"hello"}');
    expect(event).not.toBeNull();
    expect(event!.event).toBe("message");
    expect(event!.message).toBe("hello");
  });

  test("returns null for empty line", () => {
    expect(parseStreamJsonLine("")).toBeNull();
    expect(parseStreamJsonLine("   ")).toBeNull();
  });

  test("treats non-JSON as message", () => {
    const event = parseStreamJsonLine("some plain text");
    expect(event).not.toBeNull();
    expect(event!.event).toBe("message");
    expect(event!.message).toBe("some plain text");
  });

  test("extracts usage from camelCase fields", () => {
    const event = parseStreamJsonLine('{"type":"result","usage":{"inputTokens":100,"outputTokens":50,"totalTokens":150}}');
    expect(event!.usage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    });
  });

  test("extracts usage from snake_case fields", () => {
    const event = parseStreamJsonLine('{"type":"result","usage":{"input_tokens":200,"output_tokens":100,"total_tokens":300}}');
    expect(event!.usage).toEqual({
      inputTokens: 200,
      outputTokens: 100,
      totalTokens: 300,
    });
  });

  test("calculates totalTokens when missing", () => {
    const event = parseStreamJsonLine('{"type":"result","usage":{"input_tokens":32265,"output_tokens":29}}');
    expect(event!.usage).toEqual({
      inputTokens: 32265,
      outputTokens: 29,
      totalTokens: 32294,
    });
  });

  test("returns undefined usage when all zeros", () => {
    const event = parseStreamJsonLine('{"type":"assistant","usage":{"input_tokens":0,"output_tokens":0}}');
    expect(event!.usage).toBeUndefined();
  });

  test("extracts usage from modelUsage (keyed by model name)", () => {
    const event = parseStreamJsonLine('{"type":"result","modelUsage":{"glm-5.1":{"inputTokens":32265,"outputTokens":29,"cacheReadInputTokens":64}}}');
    expect(event!.usage).toEqual({
      inputTokens: 32265,
      outputTokens: 29,
      totalTokens: 32294,
    });
  });
});

describe("ClaudeCodeAdapter", () => {
  test("creates adapter with defaults", () => {
    const adapter = new ClaudeCodeAdapter();
    expect(adapter.kind).toBe("claude-code");
  });

  test("creates adapter with custom config", () => {
    const adapter = new ClaudeCodeAdapter({
      command: "claude-custom",
      timeoutMs: 60000,
    });
    expect(adapter.kind).toBe("claude-code");
  });
});
