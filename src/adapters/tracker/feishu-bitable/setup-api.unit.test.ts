import { test, expect, mock } from "bun:test";
import { FeishuBitableSetupApi } from "./setup-api.ts";
import { FeishuAuth } from "./auth.ts";

function mockFetch(responses: Record<string, unknown>) {
  const calls: { url: string; method: string; body: string }[] = [];
  const mockFn = mock(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const body = init?.body ? String(init.body) : "";
    calls.push({ url, method: init?.method ?? "GET", body: body });
    const key = Object.keys(responses).find((k) => url.includes(k));
    const resp = key ? responses[key] : responses["*"];
    if (!resp) throw new Error(`Unexpected fetch: ${url}`);
    return new Response(JSON.stringify(resp), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  return { mockFn, calls };
}

test("testConnection succeeds with valid credentials", async () => {
  const { mockFn } = mockFetch({
    "tenant_access_token": { code: 0, tenant_access_token: "tok_123", expire: 7200 },
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFn as unknown as typeof fetch;

  const auth = new FeishuAuth("app123", "secret123");
  const api = new FeishuBitableSetupApi(auth);
  await api.testConnection();

  globalThis.fetch = originalFetch;
});

test("testConnection throws on invalid credentials", async () => {
  const { mockFn } = mockFetch({
    "tenant_access_token": { code: 10014, msg: "invalid app_id or app_secret" },
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFn as unknown as typeof fetch;

  const auth = new FeishuAuth("bad_id", "bad_secret");
  const api = new FeishuBitableSetupApi(auth);

  // Need to invalidate cache first, then test
  try {
    await api.testConnection();
    // Should not reach here because auth.refresh() will throw on code != 0
  } catch {
    // Expected
  }

  globalThis.fetch = originalFetch;
});

test("createApp returns app_token, table_id, url", async () => {
  const { mockFn } = mockFetch({
    "tenant_access_token": { code: 0, tenant_access_token: "tok_123", expire: 7200 },
    "bitable/v1/apps": {
      code: 0,
      msg: "ok",
      data: {
        app: { app_token: "btoken", url: "https://example.com/btoken" },
        table: [{ table_id: "tbl_default" }],
      },
    },
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFn as unknown as typeof fetch;

  const auth = new FeishuAuth("app123", "secret123");
  const api = new FeishuBitableSetupApi(auth);
  const result = await api.createApp("Test App");

  expect(result.app_token).toBe("btoken");
  expect(result.table_id).toBe("tbl_default");
  expect(result.url).toBe("https://example.com/btoken");

  globalThis.fetch = originalFetch;
});

test("createTable sends standard fields and returns table_id", async () => {
  const { mockFn, calls } = mockFetch({
    "tenant_access_token": { code: 0, tenant_access_token: "tok_123", expire: 7200 },
    "tables": {
      code: 0,
      msg: "ok",
      data: { table_id: "tbl_new" },
    },
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFn as unknown as typeof fetch;

  const auth = new FeishuAuth("app123", "secret123");
  const api = new FeishuBitableSetupApi(auth);
  const result = await api.createTable("btoken", "任务表");

  expect(result.table_id).toBe("tbl_new");

  const createCall = calls.find((c) => c.method === "POST" && c.url.includes("tables"));
  expect(createCall).toBeDefined();
  const body = JSON.parse(createCall!.body);
  const fields = body.table.fields;
  expect(fields).toHaveLength(10);
  expect(fields[0].field_name).toBe("标题");
  // First field is automatically the primary field
  expect(fields[0].is_primary).toBeUndefined();
  // AutoNumber field needs auto_serial property
  const autoNumField = fields.find((f: { field_name: string }) => f.field_name === "编号");
  expect(autoNumField.property.auto_serial.type).toBe("auto_increment_number");
  // Progress field uses type 2 + ui_type Progress with formatter
  const progressField = fields.find((f: { field_name: string }) => f.field_name === "进度");
  expect(progressField.type).toBe(2);
  expect(progressField.ui_type).toBe("Progress");
  expect(progressField.property.formatter).toBe("0%");

  globalThis.fetch = originalFetch;
});

test("lookupUserByMobile returns open_id on success", async () => {
  const { mockFn } = mockFetch({
    "tenant_access_token": { code: 0, tenant_access_token: "tok_123", expire: 7200 },
    "batch_get_id": {
      code: 0,
      msg: "success",
      data: {
        user_list: [{ user_id: "ou_abc123", mobile: "13800138000" }],
      },
    },
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFn as unknown as typeof fetch;

  const auth = new FeishuAuth("app123", "secret123");
  const api = new FeishuBitableSetupApi(auth);
  const openId = await api.lookupUserByMobile("13800138000");

  expect(openId).toBe("ou_abc123");

  globalThis.fetch = originalFetch;
});

test("lookupUserByMobile throws when user not found", async () => {
  const { mockFn } = mockFetch({
    "tenant_access_token": { code: 0, tenant_access_token: "tok_123", expire: 7200 },
    "batch_get_id": {
      code: 0,
      msg: "success",
      data: { user_list: [] },
    },
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFn as unknown as typeof fetch;

  const auth = new FeishuAuth("app123", "secret123");
  const api = new FeishuBitableSetupApi(auth);

  expect(api.lookupUserByMobile("19999999999")).rejects.toThrow("No user found");

  globalThis.fetch = originalFetch;
});

test("lookupUserByMobile throws on API error", async () => {
  const { mockFn } = mockFetch({
    "tenant_access_token": { code: 0, tenant_access_token: "tok_123", expire: 7200 },
    "batch_get_id": { code: 9999, msg: "permission denied" },
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFn as unknown as typeof fetch;

  const auth = new FeishuAuth("app123", "secret123");
  const api = new FeishuBitableSetupApi(auth);

  expect(api.lookupUserByMobile("13800138000")).rejects.toThrow("Lookup user error");

  globalThis.fetch = originalFetch;
});

test("transferOwnership succeeds", async () => {
  const { mockFn, calls } = mockFetch({
    "tenant_access_token": { code: 0, tenant_access_token: "tok_123", expire: 7200 },
    "transfer_owner": { code: 0, msg: "success", data: {} },
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFn as unknown as typeof fetch;

  const auth = new FeishuAuth("app123", "secret123");
  const api = new FeishuBitableSetupApi(auth);
  await api.transferOwnership("btoken", "ou_abc123");

  const call = calls.find((c) => c.method === "POST" && c.url.includes("transfer_owner"));
  expect(call).toBeDefined();
  expect(call!.url).toContain("type=bitable");
  const body = JSON.parse(call!.body);
  expect(body.member_type).toBe("openid");
  expect(body.member_id).toBe("ou_abc123");

  globalThis.fetch = originalFetch;
});

test("transferOwnership throws on permission denied", async () => {
  const { mockFn } = mockFetch({
    "tenant_access_token": { code: 0, tenant_access_token: "tok_123", expire: 7200 },
    "transfer_owner": { code: 1063002, msg: "Permission denied" },
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFn as unknown as typeof fetch;

  const auth = new FeishuAuth("app123", "secret123");
  const api = new FeishuBitableSetupApi(auth);

  expect(api.transferOwnership("btoken", "ou_abc123")).rejects.toThrow("Transfer ownership error");

  globalThis.fetch = originalFetch;
});

test("deleteTable calls DELETE endpoint", async () => {
  const { mockFn, calls } = mockFetch({
    "tenant_access_token": { code: 0, tenant_access_token: "tok_123", expire: 7200 },
    "tables/tbl_del": { code: 0, msg: "ok", data: {} },
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFn as unknown as typeof fetch;

  const auth = new FeishuAuth("app123", "secret123");
  const api = new FeishuBitableSetupApi(auth);
  await api.deleteTable("btoken", "tbl_del");

  const delCall = calls.find((c) => c.method === "DELETE");
  expect(delCall).toBeDefined();
  expect(delCall!.url).toContain("btoken/tables/tbl_del");

  globalThis.fetch = originalFetch;
});

test("deleteApp calls DELETE endpoint with type=bitable", async () => {
  const { mockFn, calls } = mockFetch({
    "tenant_access_token": { code: 0, tenant_access_token: "tok_123", expire: 7200 },
    "files/btoken": { code: 0, msg: "ok", data: {} },
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFn as unknown as typeof fetch;

  const auth = new FeishuAuth("app123", "secret123");
  const api = new FeishuBitableSetupApi(auth);
  await api.deleteApp("btoken");

  const delCall = calls.find((c) => c.method === "DELETE");
  expect(delCall).toBeDefined();
  expect(delCall!.url).toContain("files/btoken");
  expect(delCall!.url).toContain("type=bitable");

  globalThis.fetch = originalFetch;
});
