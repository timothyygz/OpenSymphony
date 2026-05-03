import { describe, it, expect } from "vitest";
import { parseStreamJsonLine, type StreamJsonEvent } from "../../src/adapters/agent/claude-code/parser.ts";
import { ClaudeCodeAdapter } from "../../src/adapters/agent/claude-code/adapter.ts";

describe("parseStreamJsonLine", () => {
  it("parses valid JSON event", () => {
    const event = parseStreamJsonLine('{"type":"message","content":"hello"}');
    expect(event).not.toBeNull();
    expect(event!.event).toBe("message");
    expect(event!.message).toBe("hello");
  });

  it("returns null for empty line", () => {
    expect(parseStreamJsonLine("")).toBeNull();
    expect(parseStreamJsonLine("   ")).toBeNull();
  });

  it("treats non-JSON as message", () => {
    const event = parseStreamJsonLine("some plain text");
    expect(event).not.toBeNull();
    expect(event!.event).toBe("message");
    expect(event!.message).toBe("some plain text");
  });

  it("extracts usage from usage field", () => {
    const event = parseStreamJsonLine('{"type":"result","usage":{"inputTokens":100,"outputTokens":50,"totalTokens":150}}');
    expect(event!.usage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    });
  });

  it("extracts usage from snake_case fields", () => {
    const event = parseStreamJsonLine('{"type":"result","usage":{"input_tokens":200,"output_tokens":100,"total_tokens":300}}');
    expect(event!.usage).toEqual({
      inputTokens: 200,
      outputTokens: 100,
      totalTokens: 300,
    });
  });
});

describe("ClaudeCodeAdapter", () => {
  it("creates adapter with defaults", () => {
    const adapter = new ClaudeCodeAdapter();
    expect(adapter.kind).toBe("claude-code");
  });

  it("creates adapter with custom config", () => {
    const adapter = new ClaudeCodeAdapter({
      command: "claude-custom",
      timeoutMs: 60000,
    });
    expect(adapter.kind).toBe("claude-code");
  });
});
