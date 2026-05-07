import { test, expect, mock } from "bun:test";
import { feishuRequest } from "../../src/adapters/tracker/feishu-bitable/api.ts";
import { FeishuAuth } from "../../src/adapters/tracker/feishu-bitable/auth.ts";

function mockAuth(): FeishuAuth {
  const auth = new FeishuAuth("test-app", "test-secret");
  // Pre-cache token to avoid real HTTP calls
  (auth as any).token = "tok_test";
  (auth as any).expiresAt = Date.now() + 3600000;
  return auth;
}

test("feishuRequest returns parsed data on success", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock(async (_input: string | URL | Request, _init?: RequestInit) => {
    return new Response(JSON.stringify({ code: 0, msg: "ok", data: { result: "success" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as any;

  const auth = mockAuth();
  const result = await feishuRequest(auth, "https://open.feishu.cn/test");
  expect(result.code).toBe(0);
  expect(result.data.result).toBe("success");

  globalThis.fetch = originalFetch;
});

test("feishuRequest throws on HTTP error", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock(async () => {
    return new Response("bad request", { status: 400 });
  }) as any;

  const auth = mockAuth();
  expect(feishuRequest(auth, "https://open.feishu.cn/test")).rejects.toThrow("Feishu API error: HTTP 400");

  globalThis.fetch = originalFetch;
});

test("feishuRequest throws on non-zero code", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock(async () => {
    return new Response(JSON.stringify({ code: 9999, msg: "permission denied", data: {} }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as any;

  const auth = mockAuth();
  expect(feishuRequest(auth, "https://open.feishu.cn/test")).rejects.toThrow("Feishu API error: code=9999");

  globalThis.fetch = originalFetch;
});

test("feishuRequest sends POST with body", async () => {
  const originalFetch = globalThis.fetch;
  const calls: { method?: string; body?: string }[] = [];
  globalThis.fetch = mock(async (_input: string | URL | Request, init?: RequestInit) => {
    calls.push({ method: init?.method, body: init?.body ? String(init.body) : undefined });
    return new Response(JSON.stringify({ code: 0, msg: "ok", data: {} }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as any;

  const auth = mockAuth();
  await feishuRequest(auth, "https://open.feishu.cn/test", { method: "POST", body: { name: "test" } });

  expect(calls[0]!.method).toBe("POST");
  expect(calls[0]!.body).toBe(JSON.stringify({ name: "test" }));

  globalThis.fetch = originalFetch;
});
