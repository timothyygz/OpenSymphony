import { ClaudeCodeAdapter } from "../src/adapters/agent/claude-code/adapter.ts";
import type { AgentEvent } from "../src/adapters/agent/types.ts";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const adapter = new ClaudeCodeAdapter({
  command: "claude",
  timeoutMs: 30000,
});

const workspace = mkdtempSync(join(tmpdir(), "symphony-smoke-"));
console.log(`Workspace: ${workspace}`);

// Create a simple test file
writeFileSync(join(workspace, "hello.txt"), "Hello World\n");

const events: AgentEvent[] = [];

try {
  const session = await adapter.startSession({
    workspacePath: workspace,
    issue: {
      id: "test-1",
      identifier: "SMOKE-1",
      title: "Smoke test",
      description: "Just a test",
      priority: null,
      state: "待处理",
      branchName: null,
      url: null,
      labels: [],
      blockedBy: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    sessionId: "smoke-test",
    config: {},
  });

  console.log(`Session started: ${session.id}`);
  console.log("Running turn: ask claude to read hello.txt and report its content...");

  const result = await adapter.runTurn(
    session,
    "Read the file hello.txt in the current directory and tell me its exact content. Reply with ONLY the file content, nothing else.",
    (event) => {
      events.push(event);
      if (event.message) {
        process.stdout.write(".");
      }
    },
  );

  console.log(`\nTurn result: ${result.status}`);
  if (result.error) console.log(`Error: ${result.error}`);
  if (result.usage) console.log(`Usage: in=${result.usage.inputTokens} out=${result.usage.outputTokens} total=${result.usage.totalTokens}`);

  console.log(`\nEvents received: ${events.length}`);
  const messages = events.filter((e) => e.message).map((e) => e.message);
  if (messages.length > 0) {
    console.log(`\nLast message: ${messages[messages.length - 1]}`);
  }

  await adapter.stopSession(session);
  console.log("\nSmoke test PASSED");
} catch (err) {
  console.error(`Smoke test FAILED: ${err}`);
  process.exit(1);
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
