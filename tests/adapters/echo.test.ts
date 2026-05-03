import { test, expect, describe } from "bun:test";
import { EchoAdapter } from "../../src/adapters/agent/echo/adapter.ts";
import type { AgentEvent } from "../../src/adapters/agent/types.ts";
import type { Issue } from "../../src/model/index.ts";

const testIssue: Issue = {
  id: "test-1",
  identifier: "TEST-1",
  title: "Test",
  description: null,
  priority: null,
  state: "待处理",
  branchName: null,
  url: null,
  labels: [],
  blockedBy: [],
  createdAt: null,
  updatedAt: null,
};

describe("EchoAdapter", () => {
  const adapter = new EchoAdapter();

  test("has correct kind", () => {
    expect(adapter.kind).toBe("echo");
  });

  test("startSession returns session with metadata", async () => {
    const session = await adapter.startSession({
      workspacePath: "/tmp/test",
      issue: testIssue,
      sessionId: "sess-1",
      config: {},
    });
    expect(session.id).toBe("sess-1");
    expect(session.turnCount).toBe(0);
    expect(session.metadata.workspacePath).toBe("/tmp/test");
  });

  test("runTurn echoes prompt and completes", async () => {
    const session = await adapter.startSession({
      workspacePath: "/tmp/test",
      issue: testIssue,
      sessionId: "sess-1",
      config: {},
    });

    const events: AgentEvent[] = [];
    const result = await adapter.runTurn(session, "Hello world", (e) => events.push(e));

    expect(result.status).toBe("completed");
    expect(session.turnCount).toBe(1);
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0]!.event).toBe("message");
    expect(events[0]!.message).toContain("[echo]");
    expect(events[1]!.event).toBe("completed");
  });

  test("stopSession does not throw", async () => {
    await expect(adapter.stopSession({ id: "1", turnCount: 0, metadata: {} })).resolves.toBeUndefined();
  });
});
