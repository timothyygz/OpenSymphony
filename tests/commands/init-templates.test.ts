import { describe, test, expect } from "bun:test";
import { renderTemplate } from "../../src/workflow/prompt.ts";
import { loadTemplate } from "../../src/setup/yaml.ts";
import type { Issue } from "../../src/model/index.ts";

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "1",
    identifier: "TASK-42",
    title: "Fix login bug",
    description: "Users cannot log in with valid credentials",
    priority: 1,
    state: "In Progress",
    branchName: null,
    url: "https://example.com/issues/42",
    labels: ["bug", "urgent"],
    blockedBy: [],
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
    ...overrides,
  };
}

function makeMinimalIssue(): Issue {
  return {
    id: "2",
    identifier: "#99",
    title: "Minimal task",
    description: null,
    priority: null,
    state: "Todo",
    branchName: null,
    url: null,
    labels: [],
    blockedBy: [],
    createdAt: null,
    updatedAt: null,
  };
}

// --- Template loading tests ---

describe("Template files are loadable", () => {
  test("basic.md loads without error", () => {
    const content = loadTemplate("basic.md");
    expect(content.length).toBeGreaterThan(100);
  });

  test("chinese.md loads without error", () => {
    const content = loadTemplate("chinese.md");
    expect(content.length).toBeGreaterThan(100);
  });

  test("empty.md loads without error", () => {
    const content = loadTemplate("empty.md");
    expect(content.length).toBeGreaterThan(10);
  });
});

// --- Template rendering: basic.md ---

describe("basic.md template rendering", () => {
  const template = loadTemplate("basic.md");

  test("renders with full issue data", () => {
    const result = renderTemplate(template, makeIssue(), null);
    expect(result).toContain("TASK-42");
    expect(result).toContain("Fix login bug");
    expect(result).toContain("In Progress");
    expect(result).toContain("bug, urgent");
    expect(result).toContain("Users cannot log in with valid credentials");
  });

  test("renders with minimal issue data (null fields)", () => {
    const result = renderTemplate(template, makeMinimalIssue(), null);
    expect(result).toContain("#99");
    expect(result).toContain("Minimal task");
    expect(result).toContain("Todo");
    // description is null → "" via renderTemplate, so {% if %} is falsy
    expect(result).toContain("Description");
  });

  test("renders with retry attempt", () => {
    const result = renderTemplate(template, makeIssue(), 2);
    expect(result).toContain("retry attempt #2");
    expect(result).toContain("Resume from the current workspace state");
  });

  test("does not include continuation context on first attempt", () => {
    const result = renderTemplate(template, makeIssue(), null);
    expect(result).not.toContain("retry attempt");
    expect(result).not.toContain("Continuation Context");
  });

  test("includes all execution protocol sections", () => {
    const result = renderTemplate(template, makeIssue(), null);
    expect(result).toContain("Step 1: Understand the task");
    expect(result).toContain("Step 2: Plan");
    expect(result).toContain("Step 3: Implement");
    expect(result).toContain("Step 4: Validate");
    expect(result).toContain("Step 5: Report");
  });

  test("includes guardrails section", () => {
    const result = renderTemplate(template, makeIssue(), null);
    expect(result).toContain("Guardrails");
    expect(result).toContain("Do not modify files outside the workspace");
    expect(result).toContain("Do not add features beyond what was asked");
    expect(result).toContain("out-of-scope");
  });

  test("includes unattended orchestration instruction", () => {
    const result = renderTemplate(template, makeIssue(), null);
    expect(result).toContain("unattended orchestration session");
    expect(result).toContain("Never ask a human");
  });

  test("includes blocker handling instruction", () => {
    const result = renderTemplate(template, makeIssue(), null);
    expect(result).toContain("true blocker");
    expect(result).toContain("auth/permissions/secrets");
  });
});

// --- Template rendering: chinese.md ---

describe("chinese.md template rendering", () => {
  const template = loadTemplate("chinese.md");

  test("renders with full issue data", () => {
    const result = renderTemplate(template, makeIssue(), null);
    expect(result).toContain("TASK-42");
    expect(result).toContain("Fix login bug");
    expect(result).toContain("In Progress");
    expect(result).toContain("bug、urgent");
    expect(result).toContain("Users cannot log in with valid credentials");
  });

  test("renders with minimal issue data (null fields)", () => {
    const result = renderTemplate(template, makeMinimalIssue(), null);
    expect(result).toContain("#99");
    expect(result).toContain("Minimal task");
    expect(result).toContain("Todo");
    // description is null → "" via renderTemplate, so {% if %} is falsy
    expect(result).toContain("描述");
  });

  test("renders with retry attempt in Chinese", () => {
    const result = renderTemplate(template, makeIssue(), 3);
    expect(result).toContain("第 3 次重试");
    expect(result).toContain("继续执行上下文");
  });

  test("does not include continuation context on first attempt", () => {
    const result = renderTemplate(template, makeIssue(), null);
    expect(result).not.toContain("重试");
    expect(result).not.toContain("继续执行上下文");
  });

  test("includes all execution protocol sections in Chinese", () => {
    const result = renderTemplate(template, makeIssue(), null);
    expect(result).toContain("第一步：理解任务");
    expect(result).toContain("第二步：规划");
    expect(result).toContain("第三步：实施");
    expect(result).toContain("第四步：验证");
    expect(result).toContain("第五步：报告");
  });

  test("includes guardrails section in Chinese", () => {
    const result = renderTemplate(template, makeIssue(), null);
    expect(result).toContain("约束");
    expect(result).toContain("不要修改工作空间之外的文件");
    expect(result).toContain("不要添加超出任务要求的功能");
  });

  test("includes unattended orchestration instruction in Chinese", () => {
    const result = renderTemplate(template, makeIssue(), null);
    expect(result).toContain("无人值守");
    expect(result).toContain("不要请求人工介入");
  });

  test("includes blocker handling instruction in Chinese", () => {
    const result = renderTemplate(template, makeIssue(), null);
    expect(result).toContain("阻塞");
    expect(result).toContain("认证/权限/密钥");
  });
});

// --- Template rendering: empty.md ---

describe("empty.md template rendering", () => {
  const template = loadTemplate("empty.md");

  test("renders with issue data", () => {
    const result = renderTemplate(template, makeIssue(), null);
    expect(result).toContain("TASK-42");
    expect(result).toContain("Fix login bug");
    expect(result).toContain("Users cannot log in with valid credentials");
  });

  test("renders with retry attempt", () => {
    const result = renderTemplate(template, makeIssue(), 2);
    expect(result).toContain("Retry attempt #2");
  });

  test("does not include continuation context on first attempt", () => {
    const result = renderTemplate(template, makeIssue(), null);
    expect(result).not.toContain("retry");
  });
});

// --- Structural consistency checks ---

describe("Template structural consistency", () => {
  test("basic.md and chinese.md have matching section structure", () => {
    const basic = loadTemplate("basic.md");
    const chinese = loadTemplate("chinese.md");

    // Both should have the same number of execution steps
    const basicSteps = basic.match(/### Step \d+:/g);
    const chineseSteps = chinese.match(/### 第.+步：/g);
    expect(basicSteps).not.toBeNull();
    expect(chineseSteps).not.toBeNull();
    expect(basicSteps!.length).toBe(chineseSteps!.length);
  });

  test("all templates handle attempt conditionally", () => {
    const templates = ["basic.md", "chinese.md", "empty.md"];
    for (const file of templates) {
      const content = loadTemplate(file);
      expect(content).toContain("{% if attempt %}");
    }
  });

  test("all templates reference issue.identifier and issue.title", () => {
    const templates = ["basic.md", "chinese.md", "empty.md"];
    for (const file of templates) {
      const content = loadTemplate(file);
      expect(content).toContain("issue.identifier");
      expect(content).toContain("issue.title");
    }
  });
});
