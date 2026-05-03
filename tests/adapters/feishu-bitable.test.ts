import { describe, it, expect } from "vitest";
import { mapRecordToIssue } from "../../src/adapters/tracker/feishu-bitable/mapper.ts";
import type { BitableRecord } from "../../src/adapters/tracker/feishu-bitable/api.ts";

const mapping = {
  stateField: "状态",
  identifierField: "编号",
  titleField: "标题",
  descriptionField: "描述",
  priorityField: "优先级",
  labelsField: "标签",
};

function makeRecord(overrides: Partial<BitableRecord["fields"]> = {}): BitableRecord {
  return {
    record_id: "rec001",
    fields: {
      "编号": "MT-100",
      "标题": "Test issue",
      "描述": "Description here",
      "状态": "待处理",
      "优先级": 1,
      "标签": ["bug", "frontend"],
      ...overrides,
    },
    created_time: 1700000000,
    last_modified_time: 1700000100,
  };
}

describe("mapRecordToIssue", () => {
  it("maps all basic fields", () => {
    const issue = mapRecordToIssue(makeRecord(), mapping);
    expect(issue.id).toBe("rec001");
    expect(issue.identifier).toBe("MT-100");
    expect(issue.title).toBe("Test issue");
    expect(issue.description).toBe("Description here");
    expect(issue.state).toBe("待处理");
    expect(issue.priority).toBe(1);
    expect(issue.labels).toEqual(["bug", "frontend"]);
    expect(issue.blockedBy).toEqual([]);
  });

  it("handles null fields gracefully", () => {
    const issue = mapRecordToIssue(makeRecord({
      "描述": null,
      "优先级": null,
      "标签": null,
    }), mapping);
    expect(issue.description).toBeNull();
    expect(issue.priority).toBeNull();
    expect(issue.labels).toEqual([]);
  });

  it("lowercases labels", () => {
    const issue = mapRecordToIssue(makeRecord({
      "标签": ["Bug", "FRONTEND", "API"],
    }), mapping);
    expect(issue.labels).toEqual(["bug", "frontend", "api"]);
  });

  it("coerces string priority to int", () => {
    const issue = mapRecordToIssue(makeRecord({ "优先级": "3" }), mapping);
    expect(issue.priority).toBe(3);
  });

  it("returns null for non-integer priority", () => {
    const issue = mapRecordToIssue(makeRecord({ "优先级": "high" }), mapping);
    expect(issue.priority).toBeNull();
  });

  it("converts timestamps to Date", () => {
    const issue = mapRecordToIssue(makeRecord(), mapping);
    expect(issue.createdAt).toBeInstanceOf(Date);
    expect(issue.updatedAt).toBeInstanceOf(Date);
  });

  it("falls back to record_id when identifier is missing", () => {
    const issue = mapRecordToIssue(makeRecord({ "编号": null }), mapping);
    expect(issue.identifier).toBe("rec001");
  });

  it("handles rich text description (array of {text})", () => {
    const issue = mapRecordToIssue(makeRecord({
      "描述": { text: [{ text: "Hello " }, { text: "World" }] },
    }), mapping);
    expect(issue.description).toBe("Hello World");
  });

  it("handles rich text description as direct array (Feishu native format)", () => {
    const issue = mapRecordToIssue(makeRecord({
      "描述": [{ text: "Hello " }, { text: "World" }],
    }), mapping);
    expect(issue.description).toBe("Hello World");
  });

  it("handles empty rich text array", () => {
    const issue = mapRecordToIssue(makeRecord({
      "描述": [],
    }), mapping);
    expect(issue.description).toBeNull();
  });
});
