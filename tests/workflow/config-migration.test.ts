import { test, expect, describe } from "bun:test";
import { buildServiceConfig } from "../../src/workflow/config.ts";
import { parseWorkflowContent } from "../../src/workflow/loader.ts";

function makeConfig(yaml: string, root = "/tmp/test"): ReturnType<typeof buildServiceConfig> {
  const content = `---
tracker:
  kind: feishu_bitable
  app_id: test
  app_secret: test
  app_token: test
  table_id: test
  state_field: "状态"
  identifier_field: "编号"
  title_field: "标题"
  active_states: ["待处理"]
  terminal_states: ["已完成"]
workspace:
  root: "${root}"
${yaml}
---`;
  const workflow = parseWorkflowContent(content);
  return buildServiceConfig(workflow.config, "/");
}

describe("Config backward compatibility", () => {
  test("new unified agent config works", () => {
    const config = makeConfig(`
agent:
  kind: claude-code
  max_concurrent_agents: 5
  stall_timeout_ms: 60000
  config:
    command: claude
    timeout_ms: 3600000
`);
    expect(config.agent.kind).toBe("claude-code");
    expect(config.agent.max_concurrent_agents).toBe(5);
    expect(config.agent.stall_timeout_ms).toBe(60000);
    expect(config.agent.config.command).toBe("claude");
  });

  test("legacy claude_code config migrates to agent", () => {
    const config = makeConfig(`
claude_code:
  command: claude
  timeout_ms: 3600000
  approval_policy: auto
`);
    expect(config.agent.kind).toBe("claude-code");
    expect(config.agent.config.command).toBe("claude");
    expect(config.agent.config.approval_policy).toBe("auto");
  });

  test("legacy codex config migrates to agent", () => {
    const config = makeConfig(`
codex:
  command: claude
  stall_timeout_ms: 120000
`);
    expect(config.agent.kind).toBe("claude-code");
    expect(config.agent.config.command).toBe("claude");
    expect(config.agent.stall_timeout_ms).toBe(120000);
  });

  test("defaults to claude-code kind when no agent config", () => {
    const config = makeConfig("");
    expect(config.agent.kind).toBe("claude-code");
    expect(config.agent.stall_timeout_ms).toBe(300000);
    expect(config.agent.in_progress_state).toBe("进行中");
    expect(config.agent.active_reset_state).toBe("待处理");
  });

  test("echo kind works in config", () => {
    const config = makeConfig(`
agent:
  kind: echo
  config: {}
`);
    expect(config.agent.kind).toBe("echo");
  });
});

describe("Agent adapter registry", () => {
  test("echo adapter registers and creates", async () => {
    const { createAgent } = await import("../../src/adapters/agent/registry.ts");
    await import("../../src/adapters/agent/echo/register.ts");
    const adapter = createAgent("echo", {});
    expect(adapter.kind).toBe("echo");
  });
});
