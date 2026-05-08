import { describe, test, expect } from "bun:test";
import { renderTemplate, buildContinuationGuidance } from "../../src/workflow/prompt.ts";
import type { Issue } from "../../src/model/index.ts";

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "1",
    identifier: "#1",
    title: "Test issue",
    description: "Some description",
    priority: 1,
    state: "Todo",
    branchName: null,
    url: "https://gitlab.com/project/-/issues/1",
    labels: ["bug"],
    blockedBy: [],
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
    ...overrides,
  };
}

describe("renderTemplate", () => {
  test("renders basic template with all fields", () => {
    const tpl = "{{ issue.title }} ({{ issue.state }})";
    const result = renderTemplate(tpl, makeIssue(), null);
    expect(result).toBe("Test issue (Todo)");
  });

  test("renders with attempt", () => {
    const tpl = "attempt={{ attempt }}";
    const result = renderTemplate(tpl, makeIssue(), 3);
    expect(result).toBe("attempt=3");
  });

  test("renders with null attempt", () => {
    const tpl = "{% if attempt %}retry{% else %}first{% endif %}";
    const result = renderTemplate(tpl, makeIssue(), null);
    expect(result).toBe("first");
  });

  // --- Null field fallbacks (the bug we fixed) ---

  test("renders when priority is null", () => {
    const tpl = "priority={{ issue.priority }}";
    const result = renderTemplate(tpl, makeIssue({ priority: null }), null);
    expect(result).toBe("priority=");
  });

  test("renders when description is null", () => {
    const tpl = "desc={{ issue.description }}";
    const result = renderTemplate(tpl, makeIssue({ description: null }), null);
    expect(result).toBe("desc=");
  });

  test("renders when url is null", () => {
    const tpl = "url={{ issue.url }}";
    const result = renderTemplate(tpl, makeIssue({ url: null }), null);
    expect(result).toBe("url=");
  });

  test("renders when branchName is null", () => {
    const tpl = "branch={{ issue.branch_name }}";
    const result = renderTemplate(tpl, makeIssue({ branchName: null }), null);
    expect(result).toBe("branch=");
  });

  test("renders when createdAt is null", () => {
    const tpl = "created={{ issue.created_at }}";
    const result = renderTemplate(tpl, makeIssue({ createdAt: null }), null);
    expect(result).toBe("created=");
  });

  test("renders when all nullable fields are null", () => {
    const issue: Issue = {
      id: "2", identifier: "#2", title: "Minimal",
      description: null, priority: null, state: "In Progress",
      branchName: null, url: null, labels: [], blockedBy: [],
      createdAt: null, updatedAt: null,
    };
    const tpl = [
      "{{ issue.title }}",
      "{{ issue.state }}",
      "{{ issue.priority }}",
      "{{ issue.description }}",
      "{{ issue.branch_name }}",
      "{{ issue.url }}",
      "{{ issue.created_at }}",
    ].join("|");

    const result = renderTemplate(tpl, issue, null);
    expect(result).toBe("Minimal|In Progress|||||");
  });

  // --- Template parse error ---

  test("throws on invalid template syntax", () => {
    expect(() => renderTemplate("{% invalid", makeIssue(), null)).toThrow();
  });

  // --- Undefined variable (strict mode) ---

  test("throws on truly undefined variable", () => {
    const tpl = "{{ issue.nonexistent_field }}";
    expect(() => renderTemplate(tpl, makeIssue(), null)).toThrow();
  });

  // --- Realistic template from WORKFLOW.md ---

  test("renders realistic Chinese prompt template", () => {
    const tpl = [
      "你是一个 AI 编程助手，正在自主处理工单 {{ issue.identifier }}：{{ issue.title }}。",
      "{% if attempt %}这是第 {{ attempt }} 次重试。{% endif %}",
      "## 工单上下文",
      "- 编号：{{ issue.identifier }}",
      "- 状态：{{ issue.state }}",
      "- 标签：{{ issue.labels | join: \"、\" }}",
      "## 描述",
      "{{ issue.description }}",
    ].join("\n");

    const issue: Issue = {
      id: "2", identifier: "#2", title: "修复登录bug",
      description: "用户无法登录", priority: null, state: "In Progress",
      branchName: null, url: null, labels: ["bug", "urgent"],
      blockedBy: [], createdAt: null, updatedAt: null,
    };

    const result = renderTemplate(tpl, issue, 2);
    expect(result).toContain("工单 #2：修复登录bug");
    expect(result).toContain("用户无法登录");
    expect(result).toContain("In Progress");
    expect(result).toContain("bug、urgent");
    expect(result).toContain("第 2 次重试");
  });
});

describe("buildContinuationGuidance", () => {
  test("without attempt", () => {
    const result = buildContinuationGuidance(makeIssue(), null);
    expect(result).toContain("#1: Test issue");
    expect(result).toContain("Todo");
    expect(result).not.toContain("retry");
    expect(result).toContain("tracker_tool");
  });

  test("with attempt", () => {
    const result = buildContinuationGuidance(makeIssue(), 3);
    expect(result).toContain("retry attempt #3");
    expect(result).toContain("Resume from the current workspace state");
  });
});
