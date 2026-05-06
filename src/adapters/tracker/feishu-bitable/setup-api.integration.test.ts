import { test, expect, describe, afterAll } from "bun:test";
import { FeishuBitableSetupApi } from "./setup-api.ts";
import { FeishuAuth } from "./auth.ts";

const APP_ID = process.env.FEISHU_APP_ID!;
const APP_SECRET = process.env.FEISHU_APP_SECRET!;
const PHONE = process.env.FEISHU_PHONE!;

const shouldRun = process.env.RUN_INTEGRATION === "true";

describe.skipIf(!shouldRun)("FeishuBitableSetupApi (integration)", () => {
  const auth = new FeishuAuth(APP_ID, APP_SECRET);
  const api = new FeishuBitableSetupApi(auth);

  // App for table CRUD tests — cleaned up afterAll
  let tableAppToken = "";
  let tableId = "";

  // App for ownership transfer — cleaned up afterAll
  let transferAppToken = "";
  let ownerOpenId = "";

  test("testConnection succeeds with real credentials", async () => {
    await api.testConnection();
  });

  test("createApp creates a real Bitable app", async () => {
    const result = await api.createApp(`OpenSymphony Table Test ${Date.now()}`);
    expect(result.app_token).toBeTruthy();
    expect(result.url).toContain("https://");
    tableAppToken = result.app_token;
    console.log(`Created app: ${result.app_token}`);
  });

  test("createTable creates a table with standard fields", async () => {
    if (!tableAppToken) throw new Error("No app_token from previous test");
    const result = await api.createTable(tableAppToken, "集成测试任务表");
    expect(result.table_id).toBeTruthy();
    tableId = result.table_id;
    console.log(`Created table: ${result.table_id}`);
  });

  test("deleteTable deletes a table", async () => {
    if (!tableAppToken || !tableId) throw new Error("No app_token or table_id from previous tests");
    await api.deleteTable(tableAppToken, tableId);
    tableId = "";
    console.log(`Deleted table`);
  });

  test("lookupUserByMobile returns open_id for real phone", async () => {
    if (!PHONE) throw new Error("FEISHU_PHONE not set in .env");
    const openId = await api.lookupUserByMobile(PHONE);
    expect(openId).toBeTruthy();
    ownerOpenId = openId;
    console.log(`Looked up user: ${openId}`);
  });

  test("transferOwnership transfers the app to the user", async () => {
    if (!ownerOpenId) throw new Error("No open_id from lookupUserByMobile test");
    const result = await api.createApp(`OpenSymphony Transfer Test ${Date.now()}`);
    expect(result.app_token).toBeTruthy();
    transferAppToken = result.app_token;
    console.log(`Created transfer app: ${result.app_token}`);

    await api.transferOwnership(transferAppToken, ownerOpenId);
    console.log(`Transferred ownership of ${transferAppToken} to ${ownerOpenId}`);
  });

  afterAll(async () => {
    // Clean up table CRUD app (bot still owns it)
    if (tableAppToken) {
      try {
        await api.deleteApp(tableAppToken);
        console.log(`Cleaned up table app: ${tableAppToken}`);
      } catch (e) {
        console.warn(`Failed to delete table app ${tableAppToken}: ${(e as Error).message}`);
      }
    }
    // Transfer app was handed off — bot can no longer delete it
    if (transferAppToken) {
      try {
        await api.deleteApp(transferAppToken);
        console.log(`Cleaned up transfer app: ${transferAppToken}`);
      } catch (e) {
        console.warn(`Cannot delete transferred app ${transferAppToken} (expected): ${(e as Error).message}`);
      }
    }
  });
});
