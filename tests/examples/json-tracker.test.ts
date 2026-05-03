/**
 * JSON File Tracker - 测试
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { JsonTrackerApi } from "../../examples/json-tracker/api.ts";
import { JsonTrackerAdapter } from "../../examples/json-tracker/adapter.ts";
import { mapRecordToIssue } from "../../examples/json-tracker/mapper.ts";
import type { JsonTrackerConfig } from "../../examples/json-tracker/types.ts";

let tempDir: string;
let config: JsonTrackerConfig;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "json-tracker-test-"));
  config = {
    filePath: join(tempDir, "tracker-data.json"),
    activeStates: ["待处理", "进行中"],
    terminalStates: ["已完成", "已取消"],
  };
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// --- API 层测试 ---

describe("JsonTrackerApi", () => {
  it("init creates the store file", () => {
    const api = new JsonTrackerApi(config);
    api.init();
    expect(existsSync(config.filePath)).toBe(true);
  });

  it("createRecord auto-generates id and identifier", () => {
    const api = new JsonTrackerApi(config);
    api.init();

    const record = api.createRecord({
      title: "Test issue",
      description: "A test",
      priority: 1,
      state: "待处理",
      labels: ["bug"],
    });

    expect(record.id).toBe("rec_100");
    expect(record.identifier).toBe("JT-100");
    expect(record.title).toBe("Test issue");
    expect(record.createdAt).toBeTruthy();
  });

  it("listRecords returns all records", () => {
    const api = new JsonTrackerApi(config);
    api.init();

    api.createRecord({ title: "A", description: null, priority: null, state: "待处理", labels: [] });
    api.createRecord({ title: "B", description: null, priority: null, state: "已完成", labels: [] });

    const records = api.listRecords();
    expect(records).toHaveLength(2);
  });

  it("listRecordsByStates filters by state", () => {
    const api = new JsonTrackerApi(config);
    api.init();

    api.createRecord({ title: "A", description: null, priority: null, state: "待处理", labels: [] });
    api.createRecord({ title: "B", description: null, priority: null, state: "已完成", labels: [] });
    api.createRecord({ title: "C", description: null, priority: null, state: "待处理", labels: [] });

    const active = api.listRecordsByStates(["待处理"]);
    expect(active).toHaveLength(2);
    expect(active.every((r) => r.state === "待处理")).toBe(true);
  });

  it("getRecordsByIds returns matching records", () => {
    const api = new JsonTrackerApi(config);
    api.init();

    const r1 = api.createRecord({ title: "A", description: null, priority: null, state: "待处理", labels: [] });
    const r2 = api.createRecord({ title: "B", description: null, priority: null, state: "已完成", labels: [] });

    const found = api.getRecordsByIds([r1.id]);
    expect(found).toHaveLength(1);
    expect(found[0]!.title).toBe("A");
  });

  it("updateRecord modifies existing record", () => {
    const api = new JsonTrackerApi(config);
    api.init();

    const record = api.createRecord({ title: "Original", description: null, priority: 1, state: "待处理", labels: [] });
    const updated = api.updateRecord(record.id, { state: "进行中", title: "Updated" });

    expect(updated!.state).toBe("进行中");
    expect(updated!.title).toBe("Updated");
    expect(updated!.id).toBe(record.id);
  });

  it("updateRecord returns null for non-existent id", () => {
    const api = new JsonTrackerApi(config);
    api.init();

    const result = api.updateRecord("nonexistent", { state: "进行中" });
    expect(result).toBeNull();
  });

  it("seedRecords creates multiple records", () => {
    const api = new JsonTrackerApi(config);
    api.init();

    const created = api.seedRecords([
      { title: "Task 1", description: null, priority: 1, state: "待处理", labels: [] },
      { title: "Task 2", description: null, priority: 2, state: "待处理", labels: [] },
    ]);

    expect(created).toHaveLength(2);
    expect(created[0]!.identifier).toBe("JT-100");
    expect(created[1]!.identifier).toBe("JT-101");
  });

  it("sequence persists across writes", () => {
    const api = new JsonTrackerApi(config);
    api.init();

    const r1 = api.createRecord({ title: "First", description: null, priority: null, state: "待处理", labels: [] });
    const r2 = api.createRecord({ title: "Second", description: null, priority: null, state: "待处理", labels: [] });

    expect(r1.identifier).toBe("JT-100");
    expect(r2.identifier).toBe("JT-101");
  });
});

// --- Mapper 层测试 ---

describe("mapRecordToIssue", () => {
  it("maps all fields correctly", () => {
    const record = {
      id: "rec_100",
      identifier: "JT-100",
      title: "Test issue",
      description: "A test description",
      priority: 1,
      state: "待处理",
      labels: ["Bug", "Frontend"],
      createdAt: "2026-01-15T10:00:00.000Z",
      updatedAt: "2026-01-15T11:00:00.000Z",
    };

    const issue = mapRecordToIssue(record);

    expect(issue.id).toBe("rec_100");
    expect(issue.identifier).toBe("JT-100");
    expect(issue.title).toBe("Test issue");
    expect(issue.description).toBe("A test description");
    expect(issue.priority).toBe(1);
    expect(issue.state).toBe("待处理");
    expect(issue.labels).toEqual(["bug", "frontend"]);
    expect(issue.createdAt).toBeInstanceOf(Date);
    expect(issue.branchName).toBeNull();
    expect(issue.url).toBeNull();
    expect(issue.blockedBy).toEqual([]);
  });

  it("handles null description", () => {
    const record = {
      id: "rec_101",
      identifier: "JT-101",
      title: "No desc",
      description: null,
      priority: null,
      state: "待处理",
      labels: [],
      createdAt: "2026-01-15T10:00:00.000Z",
      updatedAt: "2026-01-15T11:00:00.000Z",
    };

    const issue = mapRecordToIssue(record);
    expect(issue.description).toBeNull();
    expect(issue.priority).toBeNull();
  });
});

// --- Adapter 层测试 ---

describe("JsonTrackerAdapter", () => {
  it("implements TrackerAdapter interface correctly", () => {
    const adapter = new JsonTrackerAdapter(config);

    expect(adapter.kind).toBe("json_file");
  });

  it("fetchCandidateIssues returns only active state issues", async () => {
    const api = new JsonTrackerApi(config);
    api.init();

    api.createRecord({ title: "Active", description: null, priority: 1, state: "待处理", labels: [] });
    api.createRecord({ title: "Terminal", description: null, priority: 2, state: "已完成", labels: [] });

    const adapter = new JsonTrackerAdapter(config);
    const issues = await adapter.fetchCandidateIssues();

    expect(issues).toHaveLength(1);
    expect(issues[0]!.title).toBe("Active");
  });

  it("fetchIssuesByStates filters correctly", async () => {
    const api = new JsonTrackerApi(config);
    api.init();

    api.createRecord({ title: "A", description: null, priority: null, state: "待处理", labels: [] });
    api.createRecord({ title: "B", description: null, priority: null, state: "已完成", labels: [] });
    api.createRecord({ title: "C", description: null, priority: null, state: "已取消", labels: [] });

    const adapter = new JsonTrackerAdapter(config);
    const completed = await adapter.fetchIssuesByStates(["已完成", "已取消"]);

    expect(completed).toHaveLength(2);
  });

  it("fetchIssueStatesByIds returns matching issues", async () => {
    const api = new JsonTrackerApi(config);
    api.init();

    const r1 = api.createRecord({ title: "A", description: null, priority: null, state: "待处理", labels: [] });
    api.createRecord({ title: "B", description: null, priority: null, state: "待处理", labels: [] });

    const adapter = new JsonTrackerAdapter(config);
    const found = await adapter.fetchIssueStatesByIds([r1.id]);

    expect(found).toHaveLength(1);
    expect(found[0]!.title).toBe("A");
  });

  it("updateIssueState changes state in store", async () => {
    const api = new JsonTrackerApi(config);
    api.init();

    const record = api.createRecord({ title: "Test", description: null, priority: null, state: "待处理", labels: [] });

    const adapter = new JsonTrackerAdapter(config);
    await adapter.updateIssueState(record.id, "进行中");

    // Verify through a fresh API instance
    const freshApi = new JsonTrackerApi(config);
    const updated = freshApi.getRecordsByIds([record.id]);
    expect(updated[0]!.state).toBe("进行中");
  });

  it("updateIssueState throws for non-existent id", async () => {
    const adapter = new JsonTrackerAdapter(config);

    await expect(adapter.updateIssueState("nonexistent", "进行中")).rejects.toThrow("Record not found");
  });

  it("updateIssueTokens does not throw", async () => {
    const api = new JsonTrackerApi(config);
    api.init();

    const record = api.createRecord({ title: "Test", description: null, priority: null, state: "待处理", labels: [] });

    const adapter = new JsonTrackerAdapter(config);
    // Should not throw
    await adapter.updateIssueTokens(record.id, { inputTokens: 100, outputTokens: 50, totalTokens: 150 });
  });
});
