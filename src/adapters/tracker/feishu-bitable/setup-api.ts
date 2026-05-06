import { FeishuAuth } from "./auth.ts";

const FEISHU_BASE = "https://open.feishu.cn";

interface ApiResponse {
  code: number;
  msg: string;
  data: Record<string, unknown>;
}

export interface CreateAppResult {
  app_token: string;
  table_id: string;
  url: string;
}

export interface CreateTableResult {
  table_id: string;
}

export interface FieldDefinition {
  field_name: string;
  type: number;
  ui_type?: string;
  property?: Record<string, unknown>;
}

const STANDARD_FIELDS: FieldDefinition[] = [
  { field_name: "标题", type: 1 },
  { field_name: "编号", type: 1005, property: { auto_serial: { type: "auto_increment_number" } } },
  {
    field_name: "状态",
    type: 3,
    property: {
      options: [
        { name: "待处理" },
        { name: "进行中" },
        { name: "已完成" },
        { name: "已取消" },
        { name: "已关闭" },
      ],
    },
  },
  { field_name: "描述", type: 1 },
  {
    field_name: "优先级",
    type: 3,
    property: {
      options: [
        { name: "P0" },
        { name: "P1" },
        { name: "P2" },
        { name: "P3" },
      ],
    },
  },
  {
    field_name: "标签",
    type: 4,
    property: { options: [] },
  },
  { field_name: "tokens消耗", type: 2 },
  { field_name: "进度", type: 2, ui_type: "Progress", property: { formatter: "0%" } },
  { field_name: "结果摘要", type: 1 },
  { field_name: "操作命令", type: 1 },
];

export class FeishuBitableSetupApi {
  constructor(private readonly auth: FeishuAuth) {}

  async testConnection(): Promise<void> {
    // getAccessToken triggers auth, will throw on invalid credentials
    await this.auth.getAccessToken();
  }

  async createApp(name: string): Promise<CreateAppResult> {
    const token = await this.auth.getAccessToken();
    const resp = await fetch(`${FEISHU_BASE}/open-apis/bitable/v1/apps`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ name }),
    });

    if (!resp.ok) {
      throw new Error(`Create Bitable app failed: HTTP ${resp.status} ${await resp.text()}`);
    }

    const data = (await resp.json()) as ApiResponse;
    if (data.code !== 0) {
      throw new Error(`Create Bitable app error: code=${data.code} msg=${data.msg}`);
    }

    const app = data.data.app as { app_token: string; url: string };
    const tables = data.data.table as { table_id: string }[];
    return {
      app_token: app.app_token,
      table_id: tables?.[0]?.table_id ?? "",
      url: app.url,
    };
  }

  async createTable(appToken: string, tableName: string): Promise<CreateTableResult> {
    const token = await this.auth.getAccessToken();
    const resp = await fetch(`${FEISHU_BASE}/open-apis/bitable/v1/apps/${appToken}/tables`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        table: {
          name: tableName,
          default_view_name: "全部",
          fields: STANDARD_FIELDS,
        },
      }),
    });

    if (!resp.ok) {
      throw new Error(`Create table failed: HTTP ${resp.status} ${await resp.text()}`);
    }

    const data = (await resp.json()) as ApiResponse;
    if (data.code !== 0) {
      throw new Error(`Create table error: code=${data.code} msg=${data.msg}`);
    }

    return { table_id: data.data.table_id as string };
  }

  async lookupUserByMobile(mobile: string): Promise<string> {
    const token = await this.auth.getAccessToken();
    const resp = await fetch(`${FEISHU_BASE}/open-apis/contact/v3/users/batch_get_id`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ mobiles: [mobile] }),
    });

    if (!resp.ok) {
      throw new Error(`Lookup user failed: HTTP ${resp.status} ${await resp.text()}`);
    }

    const data = (await resp.json()) as ApiResponse;
    if (data.code !== 0) {
      throw new Error(`Lookup user error: code=${data.code} msg=${data.msg}`);
    }

    const userList = data.data.user_list as Array<{ user_id: string }> | undefined;
    if (!userList?.length || !userList[0]!.user_id) {
      throw new Error(`No user found for mobile: ${mobile}`);
    }

    return userList[0]!.user_id;
  }

  async transferOwnership(appToken: string, openId: string): Promise<void> {
    const token = await this.auth.getAccessToken();
    const resp = await fetch(
      `${FEISHU_BASE}/open-apis/drive/v1/permissions/${appToken}/members/transfer_owner?type=bitable`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({ member_type: "openid", member_id: openId }),
      },
    );

    if (!resp.ok) {
      throw new Error(`Transfer ownership failed: HTTP ${resp.status} ${await resp.text()}`);
    }

    const data = (await resp.json()) as ApiResponse;
    if (data.code !== 0) {
      throw new Error(`Transfer ownership error: code=${data.code} msg=${data.msg}`);
    }
  }

  async deleteApp(appToken: string): Promise<void> {
    const token = await this.auth.getAccessToken();
    const resp = await fetch(
      `${FEISHU_BASE}/open-apis/drive/v1/files/${appToken}?type=bitable`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    if (!resp.ok) {
      throw new Error(`Delete app failed: HTTP ${resp.status} ${await resp.text()}`);
    }

    const data = (await resp.json()) as ApiResponse;
    if (data.code !== 0) {
      throw new Error(`Delete app error: code=${data.code} msg=${data.msg}`);
    }
  }

  async deleteTable(appToken: string, tableId: string): Promise<void> {
    const token = await this.auth.getAccessToken();
    const resp = await fetch(
      `${FEISHU_BASE}/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=utf-8",
        },
      },
    );

    if (!resp.ok) {
      throw new Error(`Delete table failed: HTTP ${resp.status} ${await resp.text()}`);
    }

    const data = (await resp.json()) as ApiResponse;
    if (data.code !== 0) {
      throw new Error(`Delete table error: code=${data.code} msg=${data.msg}`);
    }
  }
}
