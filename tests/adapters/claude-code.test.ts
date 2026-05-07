import { describe, test, expect, afterAll } from "bun:test";
import { ClaudeCodeAdapter } from "../../src/adapters/agent/claude-code/adapter.ts";
import type { AgentEvent } from "../../src/adapters/agent/types.ts";
import type { AgentSessionContext } from "../../src/adapters/agent/types.ts";
import type { Issue } from "../../src/model/issue.ts";
import { createTrackerMcpServer } from "../../src/adapters/agent/claude-code/tracker-tools.ts";
import { FeishuBitableApi } from "../../src/adapters/tracker/feishu-bitable/api.ts";
import { FeishuBitableAdapter } from "../../src/adapters/tracker/feishu-bitable/adapter.ts";
import { FeishuAuth } from "../../src/adapters/tracker/feishu-bitable/auth.ts";
import { randomUUID } from "crypto";

// Integration tests need longer timeout (SDK spawns subprocess per query)
const T = { timeout: 120_000 };

function makeSessionCtx(workspacePath?: string): AgentSessionContext {
  const issue: Issue = {
    id: "test-id",
    identifier: "TEST-1",
    title: "Integration test",
    description: null,
    priority: null,
    state: "open",
    branchName: null,
    url: null,
    labels: [],
    blockedBy: [],
    createdAt: null,
    updatedAt: null,
  };
  return {
    sessionId: randomUUID(),
    workspacePath: workspacePath ?? process.cwd(),
    issue,
    config: {},
  };
}

describe("ClaudeCodeAdapter (unit)", () => {
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

  test("startSession creates a valid session", async () => {
    const adapter = new ClaudeCodeAdapter();
    const session = await adapter.startSession(makeSessionCtx());

    expect(session.id).toBeDefined();
    expect(session.turnCount).toBe(0);
    expect(session.metadata.workspacePath).toBe(process.cwd());
  });
});

describe.skipIf(!process.env.SYMPHONY_INTEGRATION)("ClaudeCodeAdapter (integration)", () => {
  test(
    "runTurn completes a single-turn query",
    async () => {
      const adapter = new ClaudeCodeAdapter();
      const session = await adapter.startSession(makeSessionCtx());

      const events: AgentEvent[] = [];
      const result = await adapter.runTurn(
        session,
        "Reply with exactly: pong",
        (e) => events.push(e),
      );

      expect(result.status).toBe("completed");
      expect(session.turnCount).toBe(1);
      expect(session.metadata.realSessionId).toBeDefined();

      const systemEvents = events.filter((e) => e.event === "system");
      expect(systemEvents.length).toBeGreaterThanOrEqual(1);

      const assistantEvents = events.filter(
        (e) => e.event === "assistant" && e.message,
      );
      expect(assistantEvents.length).toBeGreaterThanOrEqual(1);

      const resultEvents = events.filter((e) => e.event === "result");
      expect(resultEvents.length).toBeGreaterThanOrEqual(1);
    },
    T,
  );

  test(
    "runTurn captures token usage",
    async () => {
      const adapter = new ClaudeCodeAdapter();
      const session = await adapter.startSession(makeSessionCtx());

      const result = await adapter.runTurn(
        session,
        "Reply with exactly: hello",
        () => {},
      );

      expect(result.status).toBe("completed");
      if (result.usage) {
        expect(result.usage.inputTokens).toBeGreaterThan(0);
        expect(result.usage.outputTokens).toBeGreaterThan(0);
        expect(result.usage.totalTokens).toBe(
          result.usage.inputTokens + result.usage.outputTokens,
        );
      }
    },
    T,
  );

  test(
    "runTurn resumes a session across two turns",
    async () => {
      const adapter = new ClaudeCodeAdapter();
      const session = await adapter.startSession(makeSessionCtx());

      const events1: AgentEvent[] = [];
      const result1 = await adapter.runTurn(
        session,
        "Remember the secret word: bluefish. Reply with exactly: got it",
        (e) => events1.push(e),
      );
      expect(result1.status).toBe("completed");
      expect(session.metadata.realSessionId).toBeDefined();

      const events2: AgentEvent[] = [];
      const result2 = await adapter.runTurn(
        session,
        "What was the secret word? Reply with exactly that word, nothing else.",
        (e) => events2.push(e),
      );
      expect(result2.status).toBe("completed");
      expect(session.turnCount).toBe(2);

      const assistantEvents2 = events2.filter(
        (e) => e.event === "assistant" && e.message,
      );
      const response2 = assistantEvents2
        .map((e) => e.message)
        .join(" ")
        .toLowerCase();
      expect(response2).toContain("bluefish");
    },
    T,
  );

  test(
    "stopSession terminates an active query",
    async () => {
      const adapter = new ClaudeCodeAdapter();
      const session = await adapter.startSession(makeSessionCtx());

      const turnPromise = adapter.runTurn(
        session,
        "Count from 1 to 100, one number per line.",
        () => {},
      );

      await new Promise((r) => setTimeout(r, 3000));
      await adapter.stopSession(session);

      const result = await turnPromise;
      expect(["completed", "failed", "timed_out"]).toContain(result.status);
    },
    T,
  );
});

const hasFeishu = !!(process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET && process.env.FEISHU_APP_TOKEN && process.env.FEISHU_TABLE_ID);

describe.skipIf(!process.env.SYMPHONY_INTEGRATION || !hasFeishu)("ClaudeCodeAdapter with tracker tools (integration)", () => {
  const { FEISHU_APP_ID, FEISHU_APP_SECRET, FEISHU_APP_TOKEN, FEISHU_TABLE_ID } = process.env;
  const auth = new FeishuAuth(FEISHU_APP_ID!, FEISHU_APP_SECRET!);
  const api = new FeishuBitableApi(auth, FEISHU_APP_TOKEN!, FEISHU_TABLE_ID!);
  const feishuAdapter = new FeishuBitableAdapter({
    appId: FEISHU_APP_ID!,
    appSecret: FEISHU_APP_SECRET!,
    appToken: FEISHU_APP_TOKEN!,
    tableId: FEISHU_TABLE_ID!,
    stateField: "状态",
    identifierField: "编号",
    titleField: "标题",
    descriptionField: "描述",
    activeStates: ["待处理", "进行中"],
    terminalStates: ["已完成", "已取消"],
  });
  const createdRecordIds: string[] = [];

  afterAll(async () => {
    for (const id of createdRecordIds) {
      try {
        await api.updateRecord(id, { "状态": "已取消" });
      } catch {}
    }
  });

  test(
    "agent uses bitable tool to create a task in tracker",
    async () => {
      const adapter = new ClaudeCodeAdapter({ approvalPolicy: "auto" });
      const testTitle = `[SDK test] ${Date.now()}`;
      const trackerMcpServer = createTrackerMcpServer(feishuAdapter, "test-issue");

      const ctx = makeSessionCtx();
      ctx.mcpServers = { tracker: trackerMcpServer };

      const session = await adapter.startSession(ctx);

      const events: AgentEvent[] = [];
      const result = await adapter.runTurn(
        session,
        `Use the bitable tool to create a new record with fields: `
        + `标题 = "${testTitle}", 描述 = "Created by SDK integration test", 状态 = "已取消". `
        + `Reply with exactly the record_id of the created record, nothing else.`,
        (e) => events.push(e),
      );

      expect(result.status).toBe("completed");

      // Agent should have used the tracker tool (MCP tools are prefixed with mcp__<server>__)
      const toolEvents = events.filter(
        (e) => e.toolName?.includes("tracker"),
      );
      expect(toolEvents.length).toBeGreaterThanOrEqual(1);

      // Extract the record_id from the assistant's final response
      const assistantMessages = events
        .filter((e) => e.event === "assistant" && e.message)
        .map((e) => e.message!);
      const lastMessage = assistantMessages[assistantMessages.length - 1] ?? "";

      // Verify the record was actually created by searching in Bitable
      const allRecords = await api.listRecords();
      const created = allRecords.find((r) => r.fields["标题"] === testTitle);
      expect(created).toBeDefined();
      expect(created!.fields["描述"]).toBe("Created by SDK integration test");

      createdRecordIds.push(created!.record_id);

      // The agent's response should contain the record_id
      expect(lastMessage).toContain(created!.record_id);
    },
    { timeout: 180_000 },
  );
});
