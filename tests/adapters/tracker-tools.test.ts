import { describe, test, expect, afterAll } from "bun:test";
import { createBitableTool } from "../../src/adapters/agent/claude-code/tracker-tools.ts";
import { FeishuBitableApi } from "../../src/adapters/tracker/feishu-bitable/api.ts";
import { FeishuAuth } from "../../src/adapters/tracker/feishu-bitable/auth.ts";
import type { BitableRecord } from "../../src/adapters/tracker/feishu-bitable/api.ts";

const { FEISHU_APP_ID, FEISHU_APP_SECRET, FEISHU_APP_TOKEN, FEISHU_TABLE_ID } = process.env;

const hasFeishu = !!(FEISHU_APP_ID && FEISHU_APP_SECRET && FEISHU_APP_TOKEN && FEISHU_TABLE_ID);

const auth = new FeishuAuth(FEISHU_APP_ID!, FEISHU_APP_SECRET!);
const api = new FeishuBitableApi(auth, FEISHU_APP_TOKEN!, FEISHU_TABLE_ID!);

describe.skipIf(!hasFeishu)("Bitable tracker tools (integration)", () => {

let testRecord: BitableRecord | undefined;
let originalProgress: unknown;
let createdRecordId: string | undefined;

afterAll(async () => {
  if (testRecord) {
    try {
      await api.updateRecord(testRecord.record_id, {
        "进度": originalProgress ?? "",
      });
    } catch {}
  }
  // Clean up created test record
  if (createdRecordId) {
    try {
      await api.updateRecord(createdRecordId, { "状态": "已取消" });
    } catch {}
  }
});

async function findTestRecord(): Promise<BitableRecord> {
  if (testRecord) return testRecord;
  const records = await api.listRecords();
  const record = records.find((r) => typeof r.fields["编号"] === "string");
  if (!record) throw new Error("No test record found in Bitable");
  testRecord = record;
  return record;
}

function callHandler(args: Record<string, unknown>) {
  const issueId = testRecord?.record_id ?? "unknown";
  const toolDef = createBitableTool(api, issueId);
  return toolDef.handler(args as any, {});
}

test("list action returns records from real Bitable", async () => {
  const result = await callHandler({ action: "list" });

  expect(result.isError).toBeUndefined();
  const text = (result.content as any[])[0].text;
  const records = JSON.parse(text);
  expect(Array.isArray(records)).toBe(true);
  expect(records.length).toBeGreaterThan(0);
});

test("get action returns the current issue record", async () => {
  const record = await findTestRecord();

  const result = await callHandler({ action: "get" });

  expect(result.isError).toBeUndefined();
  const text = (result.content as any[])[0].text;
  const parsed = JSON.parse(text);
  expect(parsed.record_id).toBe(record.record_id);
});

test("get action returns error for nonexistent record", async () => {
  const result = await callHandler({ action: "get", record_id: "rec_nonexistent" });

  expect(result.isError).toBe(true);
  const text = (result.content as any[])[0].text;
  expect(text).toContain("not found");
});

test("update action writes fields to real Bitable", async () => {
  const record = await findTestRecord();
  originalProgress = record.fields["进度"];
  const progressText = `Test progress ${Date.now()}`;

  const result = await callHandler({
    action: "update",
    fields: { "进度": progressText },
  });

  expect(result.isError).toBeUndefined();
  const text = (result.content as any[])[0].text;
  expect(text).toContain("updated successfully");

  // Verify by reading back
  const records = await api.listRecords();
  const updated = records.find((r) => r.record_id === record.record_id);
  expect(updated?.fields["进度"]).toBe(progressText);
});

test("update action returns error when no fields", async () => {
  const result = await callHandler({ action: "update" });

  expect(result.isError).toBe(true);
  const text = (result.content as any[])[0].text;
  expect(text).toContain("No fields");
});

test("search action filters records", async () => {
  const result = await callHandler({
    action: "search",
    filter: {
      conjunction: "and",
      conditions: [{ field_name: "状态", operator: "is", value: ["已完成"] }],
    },
  });

  expect(result.isError).toBeUndefined();
  const text = (result.content as any[])[0].text;
  const records = JSON.parse(text);
  expect(records.length).toBeGreaterThanOrEqual(1);
  expect(records[0].fields["状态"]).toBe("已完成");
});

test("search action returns error when no filter", async () => {
  const result = await callHandler({ action: "search" });

  expect(result.isError).toBe(true);
  const text = (result.content as any[])[0].text;
  expect(text).toContain("Filter is required");
});

test("create action creates a new record in real Bitable", async () => {
  const result = await callHandler({
    action: "create",
    fields: {
      "标题": `[test] Tracker tools create test ${Date.now()}`,
      "描述": "Created by automated test, will be cleaned up",
      "状态": "已取消",
    },
  });

  expect(result.isError).toBeUndefined();
  const text = (result.content as any[])[0].text;
  const record = JSON.parse(text);
  expect(record.record_id).toBeDefined();
  expect(record.fields["标题"]).toContain("[test] Tracker tools create test");

  createdRecordId = record.record_id;

  // Verify by reading back
  const verifyResult = await callHandler({ action: "get", record_id: createdRecordId });
  expect(verifyResult.isError).toBeUndefined();
});

test("create action returns error when no fields", async () => {
  const result = await callHandler({ action: "create" });

  expect(result.isError).toBe(true);
  const text = (result.content as any[])[0].text;
  expect(text).toContain("No fields");
});
});
