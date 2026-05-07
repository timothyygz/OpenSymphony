import { FeishuAuth } from "./auth.ts";
import { FEISHU_BASE } from "./constants.ts";

export interface BitableRecord {
  record_id: string;
  fields: Record<string, unknown>;
  created_time: number;
  last_modified_time: number;
}

export interface BitableListResponse {
  code: number;
  msg: string;
  data: {
    items?: BitableRecord[];
    total?: number;
    page_token?: string;
    has_more: boolean;
  };
}

interface ApiResponse {
  code: number;
  msg: string;
  data: Record<string, unknown>;
}

export async function feishuRequest<T extends ApiResponse>(
  auth: FeishuAuth,
  url: string,
  options?: { method?: string; body?: unknown },
): Promise<T> {
  const token = await auth.getAccessToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const resp = await fetch(url, {
    method: options?.method ?? "GET",
    headers,
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });

  if (!resp.ok) {
    throw new Error(`Feishu API error: HTTP ${resp.status} ${await resp.text()}`);
  }

  const data = (await resp.json()) as T;
  if (data.code !== 0) {
    throw new Error(`Feishu API error: code=${data.code} msg=${data.msg}`);
  }

  return data;
}

export class FeishuBitableApi {
  constructor(
    private readonly auth: FeishuAuth,
    private readonly appToken: string,
    private readonly tableId: string,
  ) {}

  async listRecords(pageSize = 50): Promise<BitableRecord[]> {
    const records: BitableRecord[] = [];
    let pageToken: string | undefined;

    do {
      const params = new URLSearchParams({ page_size: String(pageSize) });
      if (pageToken) params.set("page_token", pageToken);

      const url = `${FEISHU_BASE}/open-apis/bitable/v1/apps/${this.appToken}/tables/${this.tableId}/records?${params}`;
      const data = await feishuRequest<BitableListResponse>(this.auth, url);

      if (data.data.items) {
        records.push(...data.data.items);
      }
      pageToken = data.data.has_more ? data.data.page_token : undefined;
    } while (pageToken);

    return records;
  }

  async searchRecords(filter: Record<string, unknown>, pageSize = 50): Promise<BitableRecord[]> {
    const records: BitableRecord[] = [];
    let pageToken: string | undefined;

    do {
      const body: Record<string, unknown> = { page_size: pageSize };
      if (pageToken) body.page_token = pageToken;
      if (filter) body.filter = filter;

      const url = `${FEISHU_BASE}/open-apis/bitable/v1/apps/${this.appToken}/tables/${this.tableId}/records/search`;
      const data = await feishuRequest<BitableListResponse>(this.auth, url, {
        method: "POST",
        body,
      });

      if (data.data.items) {
        records.push(...data.data.items);
      }
      pageToken = data.data.has_more ? data.data.page_token : undefined;
    } while (pageToken);

    return records;
  }

  async createRecord(fields: Record<string, unknown>): Promise<BitableRecord> {
    const url = `${FEISHU_BASE}/open-apis/bitable/v1/apps/${this.appToken}/tables/${this.tableId}/records`;
    const data = await feishuRequest<{ code: number; msg: string; data: { record: BitableRecord } }>(
      this.auth, url, { method: "POST", body: { fields } },
    );
    return data.data.record;
  }

  async updateRecord(recordId: string, fields: Record<string, unknown>): Promise<BitableRecord> {
    const url = `${FEISHU_BASE}/open-apis/bitable/v1/apps/${this.appToken}/tables/${this.tableId}/records/${recordId}`;
    const data = await feishuRequest<{ code: number; msg: string; data: { record: BitableRecord } }>(
      this.auth, url, { method: "PUT", body: { fields } },
    );
    return data.data.record;
  }
}
