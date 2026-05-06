import { test, describe, expect } from "bun:test";
import { objectToYaml, scalarYaml, buildWorkflowYaml, type WizardResult } from "../../src/commands/init-core.ts";

describe("scalarYaml", () => {
  test("passes through plain strings", () => {
    expect(scalarYaml("hello")).toBe("hello");
  });

  test("quotes strings starting with $", () => {
    expect(scalarYaml("$FEISHU_APP_ID")).toBe('"$FEISHU_APP_ID"');
  });

  test("quotes strings containing :", () => {
    expect(scalarYaml("key: value")).toBe('"key: value"');
  });

  test("quotes strings containing #", () => {
    expect(scalarYaml("value # comment")).toBe('"value # comment"');
  });

  test("quotes strings containing '", () => {
    expect(scalarYaml("it's")).toBe('"it\'s"');
  });

  test("returns 'null' for null", () => {
    expect(scalarYaml(null)).toBe("null");
  });

  test("returns 'null' for undefined", () => {
    expect(scalarYaml(undefined)).toBe("null");
  });

  test("converts numbers to strings", () => {
    expect(scalarYaml(42)).toBe("42");
    expect(scalarYaml(0)).toBe("0");
  });

  test("converts booleans to strings", () => {
    expect(scalarYaml(true)).toBe("true");
    expect(scalarYaml(false)).toBe("false");
  });
});

describe("objectToYaml", () => {
  test("serializes flat key-value pairs", () => {
    const result = objectToYaml({ name: "test", count: 5 });
    expect(result).toBe("name: test\ncount: 5");
  });

  test("serializes nested objects", () => {
    const result = objectToYaml({ tracker: { kind: "feishu_bitable" } });
    expect(result).toBe("tracker:\n  kind: feishu_bitable");
  });

  test("serializes arrays of scalars", () => {
    const result = objectToYaml({ active_states: ["待处理", "进行中"] });
    expect(result).toBe("active_states:\n  - 待处理\n  - 进行中");
  });

  test("serializes empty arrays", () => {
    const result = objectToYaml({ items: [] });
    expect(result).toBe("items: []");
  });

  test("serializes arrays of objects", () => {
    const result = objectToYaml({
      sources: [{ type: "git-clone", url: "git@github.com:org/repo.git", path: "repo" }],
    });
    expect(result).toContain("- type: git-clone");
    expect(result).toContain('url: "git@github.com:org/repo.git"');
    expect(result).toContain("path: repo");
  });

  test("filters out undefined values", () => {
    const result = objectToYaml({ a: "keep", b: undefined });
    expect(result).toBe("a: keep");
  });

  test("serializes null values", () => {
    const result = objectToYaml({ a: null });
    expect(result).toBe("a: null");
  });

  test("serializes booleans", () => {
    const result = objectToYaml({ enabled: true, disabled: false });
    expect(result).toBe("enabled: true\ndisabled: false");
  });

  test("handles numbers", () => {
    const result = objectToYaml({ interval_ms: 30000 });
    expect(result).toBe("interval_ms: 30000");
  });
});

describe("buildWorkflowYaml", () => {
  const baseResult: WizardResult = {
    tracker: {
      app_token: "btoken123",
      table_id: "tid456",
    },
    workspace: { root: "~/.open-symphony/workspace" },
    agent: { config: { approval_policy: "auto" } },
    promptTemplate: "# My Template\nHello world",
    feishuCredentials: { app_id: "cli_123", app_secret: "secret456" },
  };

  test("starts with --- delimiter", () => {
    const result = buildWorkflowYaml(baseResult);
    expect(result.startsWith("---\n")).toBe(true);
  });

  test("omits credentials from tracker config", () => {
    const result = buildWorkflowYaml(baseResult);
    expect(result).not.toContain("app_id");
    expect(result).not.toContain("app_secret");
  });

  test("includes prompt template after --- separator", () => {
    const result = buildWorkflowYaml(baseResult);
    expect(result).toContain("# My Template\nHello world");
  });

  test("includes polling interval", () => {
    const result = buildWorkflowYaml(baseResult);
    expect(result).toContain("interval_ms: 30000");
  });
});
