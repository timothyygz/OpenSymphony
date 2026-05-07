import { FeishuAuth } from "./auth.ts";
import { FEISHU_BASE } from "./constants.ts";
import { feishuRequest } from "./api.ts";

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
    const data = await feishuRequest<ApiResponse>(
      this.auth,
      `${FEISHU_BASE}/open-apis/bitable/v1/apps`,
      { method: "POST", body: { name } },
    );

    const app = data.data.app as { app_token: string; url: string };
    const tables = data.data.table as { table_id: string }[];
    return {
      app_token: app.app_token,
      table_id: tables?.[0]?.table_id ?? "",
      url: app.url,
    };
  }

  async createTable(appToken: string, tableName: string): Promise<CreateTableResult> {
    const data = await feishuRequest<ApiResponse>(
      this.auth,
      `${FEISHU_BASE}/open-apis/bitable/v1/apps/${appToken}/tables`,
      {
        method: "POST",
        body: {
          table: {
            name: tableName,
            default_view_name: "全部",
            fields: STANDARD_FIELDS,
          },
        },
      },
    );

    return { table_id: data.data.table_id as string };
  }

  async lookupUserByMobile(mobile: string): Promise<string> {
    const data = await feishuRequest<ApiResponse>(
      this.auth,
      `${FEISHU_BASE}/open-apis/contact/v3/users/batch_get_id`,
      { method: "POST", body: { mobiles: [mobile] } },
    );

    const userList = data.data.user_list as Array<{ user_id: string }> | undefined;
    if (!userList?.length || !userList[0]!.user_id) {
      throw new Error(`No user found for mobile: ${mobile}`);
    }

    return userList[0]!.user_id;
  }

  async transferOwnership(appToken: string, openId: string): Promise<void> {
    await feishuRequest<ApiResponse>(
      this.auth,
      `${FEISHU_BASE}/open-apis/drive/v1/permissions/${appToken}/members/transfer_owner?type=bitable`,
      { method: "POST", body: { member_type: "openid", member_id: openId } },
    );
  }

  async deleteApp(appToken: string): Promise<void> {
    await feishuRequest<ApiResponse>(
      this.auth,
      `${FEISHU_BASE}/open-apis/drive/v1/files/${appToken}?type=bitable`,
      { method: "DELETE" },
    );
  }

  async deleteTable(appToken: string, tableId: string): Promise<void> {
    await feishuRequest<ApiResponse>(
      this.auth,
      `${FEISHU_BASE}/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}`,
      { method: "DELETE" },
    );
  }
}
