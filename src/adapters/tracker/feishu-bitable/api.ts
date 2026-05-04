import { FeishuAuth } from "./auth.ts";

const FEISHU_BASE = "https://open.feishu.cn";

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

      const token = await this.auth.getAccessToken();
      const url = `${FEISHU_BASE}/open-apis/bitable/v1/apps/${this.appToken}/tables/${this.tableId}/records?${params}`;

      const resp = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (!resp.ok) {
        throw new Error(`Feishu API error: HTTP ${resp.status} ${await resp.text()}`);
      }

      const data = (await resp.json()) as BitableListResponse;
      if (data.code !== 0) {
        throw new Error(`Feishu API error: code=${data.code} msg=${data.msg}`);
      }

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

      const token = await this.auth.getAccessToken();
      const url = `${FEISHU_BASE}/open-apis/bitable/v1/apps/${this.appToken}/tables/${this.tableId}/records/search`;

      const resp = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        throw new Error(`Feishu API error: HTTP ${resp.status} ${await resp.text()}`);
      }

      const data = (await resp.json()) as BitableListResponse;
      if (data.code !== 0) {
        throw new Error(`Feishu API error: code=${data.code} msg=${data.msg}`);
      }

      if (data.data.items) {
        records.push(...data.data.items);
      }
      pageToken = data.data.has_more ? data.data.page_token : undefined;
    } while (pageToken);

    return records;
  }

  async createRecord(fields: Record<string, unknown>): Promise<BitableRecord> {
    const token = await this.auth.getAccessToken();
    const url = `${FEISHU_BASE}/open-apis/bitable/v1/apps/${this.appToken}/tables/${this.tableId}/records`;

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fields }),
    });

    if (!resp.ok) {
      throw new Error(`Feishu API error: HTTP ${resp.status} ${await resp.text()}`);
    }

    const data = (await resp.json()) as { code: number; msg: string; data: { record: BitableRecord } };
    if (data.code !== 0) {
      throw new Error(`Feishu API error: code=${data.code} msg=${data.msg}`);
    }

    return data.data.record;
  }

  async updateRecord(recordId: string, fields: Record<string, unknown>): Promise<BitableRecord> {
    const token = await this.auth.getAccessToken();
    const url = `${FEISHU_BASE}/open-apis/bitable/v1/apps/${this.appToken}/tables/${this.tableId}/records/${recordId}`;

    const resp = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fields }),
    });

    if (!resp.ok) {
      throw new Error(`Feishu API error: HTTP ${resp.status} ${await resp.text()}`);
    }

    const data = (await resp.json()) as { code: number; msg: string; data: { record: BitableRecord } };
    if (data.code !== 0) {
      throw new Error(`Feishu API error: code=${data.code} msg=${data.msg}`);
    }

    return data.data.record;
  }
}
