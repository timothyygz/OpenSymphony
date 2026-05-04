import { test, expect, describe, afterAll, beforeEach } from "bun:test";
import { buildServiceConfig, resetGlobalSettingsCache } from "../../src/workflow/config.ts";
import { parseWorkflowContent } from "../../src/workflow/loader.ts";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const SETTINGS_DIR = resolve("/tmp", "open-symphony-test", ".open-symphony");
const SETTINGS_PATH = resolve(SETTINGS_DIR, "settings.json");

function writeTestSettings(content: Record<string, unknown>) {
  mkdirSync(SETTINGS_DIR, { recursive: true });
  writeFileSync(SETTINGS_PATH, JSON.stringify(content, null, 2));
}

function removeTestSettings() {
  if (existsSync(SETTINGS_PATH)) rmSync(SETTINGS_PATH);
  if (existsSync(SETTINGS_DIR)) rmSync(SETTINGS_DIR, { recursive: true });
}

function makeWorkflow(yaml: string) {
  const content = `---
tracker:
  kind: feishu_bitable
  ${yaml}
  state_field: "状态"
  identifier_field: "编号"
  title_field: "标题"
  active_states: ["待处理"]
  terminal_states: ["已完成"]
workspace:
  root: "/tmp/test"
agent:
  kind: claude-code
  config:
    command: claude
---`;
  const workflow = parseWorkflowContent(content);
  return buildServiceConfig(workflow.config, "/");
}

describe("Global settings from ~/.open-symphony/settings.json", () => {
  beforeEach(() => {
    resetGlobalSettingsCache();
    process.env.SYMPHONY_SETTINGS_PATH = SETTINGS_PATH;
    removeTestSettings();
  });

  afterAll(() => {
    delete process.env.SYMPHONY_SETTINGS_PATH;
    removeTestSettings();
  });

  test("fills missing credentials from settings.json", () => {
    writeTestSettings({
      tracker: {
        feishu: {
          app_id: "cli_from_settings",
          app_secret: "secret_from_settings",
          app_token: "token_from_settings",
          table_id: "tbl_from_settings",
        },
      },
    });

    const config = makeWorkflow(`
  # no app_id/secret/token/table_id specified
`);
    expect(config.tracker.app_id).toBe("cli_from_settings");
    expect(config.tracker.app_secret).toBe("secret_from_settings");
    expect(config.tracker.app_token).toBe("token_from_settings");
    expect(config.tracker.table_id).toBe("tbl_from_settings");
  });

  test("WORKFLOW.md explicit values take priority over settings.json", () => {
    writeTestSettings({
      tracker: {
        feishu: {
          app_id: "cli_from_settings",
          app_secret: "secret_from_settings",
        },
      },
    });

    const config = makeWorkflow(`
  app_id: cli_from_workflow
  app_secret: secret_from_workflow
  app_token: token_from_workflow
  table_id: tbl_from_workflow
`);
    expect(config.tracker.app_id).toBe("cli_from_workflow");
    expect(config.tracker.app_secret).toBe("secret_from_workflow");
  });

  test("missing settings.json is handled gracefully", () => {
    removeTestSettings();
    const config = makeWorkflow(`
  app_id: cli_x
  app_secret: sec_x
  app_token: tok_x
  table_id: tbl_x
`);
    expect(config.tracker.app_id).toBe("cli_x");
  });

  test("malformed JSON is silently ignored", () => {
    mkdirSync(SETTINGS_DIR, { recursive: true });
    writeFileSync(SETTINGS_PATH, "{ invalid json");

    const config = makeWorkflow(`
  app_id: cli_x
  app_secret: sec_x
  app_token: tok_x
  table_id: tbl_x
`);
    expect(config.tracker.app_id).toBe("cli_x");
  });

  test("partial settings.json only fills specified fields", () => {
    writeTestSettings({
      tracker: {
        feishu: {
          app_id: "cli_from_settings",
          app_secret: "secret_from_settings",
        },
      },
    });

    const config = makeWorkflow(`
  app_token: token_from_workflow
  table_id: tbl_from_workflow
`);
    expect(config.tracker.app_id).toBe("cli_from_settings");
    expect(config.tracker.app_secret).toBe("secret_from_settings");
    expect(config.tracker.app_token).toBe("token_from_workflow");
    expect(config.tracker.table_id).toBe("tbl_from_workflow");
  });
});
