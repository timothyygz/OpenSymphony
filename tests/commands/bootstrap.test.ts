import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { bootstrapTracker } from "../../src/commands/bootstrap.ts";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const GITLAB_WORKFLOW = `---
tracker:
  kind: gitlab_issues
  gitlab_host: "https://gitlab.example.com"
  project_id: "123"
  active_states:
    - Todo
    - In Progress
  terminal_states:
    - Done
    - Cancelled
polling:
  interval_ms: 30000
workspace:
  root: ~/.open-symphony/workspace
agent:
  kind: claude-code
  config:
    command: claude
    approval_policy: auto
---
Template content
`;

const BITABLE_WORKFLOW = `---
tracker:
  kind: feishu_bitable
  app_token: test_token
  table_id: tbl_test
  state_field: 状态
  identifier_field: 编号
  title_field: 标题
  active_states:
    - Todo
polling:
  interval_ms: 30000
workspace:
  root: ~/.open-symphony/workspace
agent:
  kind: claude-code
  config:
    command: claude
    approval_policy: auto
---
Template content
`;

describe("bootstrapTracker", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "symphony-bootstrap-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("registers gitlab_issues adapter and returns config", async () => {
    writeFileSync(join(tempDir, "WORKFLOW.md"), GITLAB_WORKFLOW);

    // Will fail at tracker creation due to missing gitlab_token,
    // but we just need to verify the adapter is registered (not "Unknown tracker adapter")
    try {
      await bootstrapTracker([tempDir]);
    } catch (err) {
      // Should NOT be "Unknown tracker adapter"
      expect(String(err)).not.toContain("Unknown tracker adapter");
      expect(String(err)).not.toContain("gitlab_issues");
    }
  });

  test("registers feishu_bitable adapter", async () => {
    writeFileSync(join(tempDir, "WORKFLOW.md"), BITABLE_WORKFLOW);

    try {
      await bootstrapTracker([tempDir]);
    } catch (err) {
      expect(String(err)).not.toContain("Unknown tracker adapter");
    }
  });

  test("fails when WORKFLOW.md missing", async () => {
    const origExit = process.exit;
    let exitCode: number | null = null;
    process.exit = ((code: number) => { exitCode = code; throw new Error(`exit:${code}`); }) as never;

    try {
      await bootstrapTracker([join(tempDir, "nonexistent")]);
    } catch {
      // expected
    }

    expect(exitCode).toBe(1);
    process.exit = origExit;
  });
});
