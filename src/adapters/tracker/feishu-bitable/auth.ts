import { FEISHU_BASE } from "./constants.ts";

interface TokenResponse {
  code: number;
  tenant_access_token: string;
  expire: number;
}

export class FeishuAuth {
  private token: string | null = null;
  private expiresAt = 0;

  constructor(
    private readonly appId: string,
    private readonly appSecret: string,
  ) {}

  async getAccessToken(): Promise<string> {
    if (this.token && Date.now() < this.expiresAt) {
      return this.token;
    }
    return this.refresh();
  }

  private async refresh(): Promise<string> {
    const resp = await fetch(`${FEISHU_BASE}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app_id: this.appId,
        app_secret: this.appSecret,
      }),
    });

    if (!resp.ok) {
      throw new Error(`Feishu auth failed: HTTP ${resp.status}`);
    }

    const data = (await resp.json()) as TokenResponse;
    if (data.code !== 0) {
      throw new Error(`Feishu auth error: code=${data.code}`);
    }

    this.token = data.tenant_access_token;
    // Refresh 5 minutes before expiry
    this.expiresAt = Date.now() + (data.expire - 300) * 1000;
    return this.token;
  }

  invalidate(): void {
    this.token = null;
    this.expiresAt = 0;
  }
}
