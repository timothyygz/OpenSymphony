import type { TrackerAdapter, CreateIssueData, HealthCheckResult } from "../types.ts";
import type { Issue, TokenUsage } from "../../../model/index.ts";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { FeishuAuth } from "./auth.ts";
import { FeishuBitableApi } from "./api.ts";
import { mapRecordToIssue, type FieldMapping } from "./mapper.ts";
import { logger } from "../../../logging/logger.ts";
import { createTrackerMcpServer } from "../../agent/claude-code/tracker-tools.ts";

export interface FeishuBitableConfig {
  appId: string;
  appSecret: string;
  appToken: string;
  tableId: string;
  stateField: string;
  identifierField: string;
  titleField: string;
  descriptionField: string;
  priorityField?: string;
  labelsField?: string;
  tokensField?: string;
  joinCommandField?: string;
  progressField?: string;
  resultSummaryField?: string;
  activeStates: string[];
  terminalStates: string[];
}

export class FeishuBitableAdapter implements TrackerAdapter {
  readonly kind = "feishu_bitable";
  private readonly auth: FeishuAuth;
  readonly api: FeishuBitableApi;
  private readonly fieldMapping: FieldMapping;
  private readonly tokensField: string | undefined;
  private readonly joinCommandField: string | undefined;
  private readonly progressField: string | undefined;
  private readonly resultSummaryField: string | undefined;
  private readonly activeStates: string[];
  private readonly terminalStates: string[];

  constructor(config: FeishuBitableConfig) {
    this.auth = new FeishuAuth(config.appId, config.appSecret);
    this.api = new FeishuBitableApi(this.auth, config.appToken, config.tableId);
    this.fieldMapping = {
      stateField: config.stateField,
      identifierField: config.identifierField,
      titleField: config.titleField,
      descriptionField: config.descriptionField,
      priorityField: config.priorityField,
      labelsField: config.labelsField,
    };
    this.tokensField = config.tokensField;
    this.joinCommandField = config.joinCommandField;
    this.progressField = config.progressField;
    this.resultSummaryField = config.resultSummaryField;
    this.activeStates = config.activeStates.map((s) => s.trim());
    this.terminalStates = config.terminalStates.map((s) => s.trim());
  }

  async fetchCandidateIssues(): Promise<Issue[]> {
    const filter = {
      conjunction: "or" as const,
      conditions: this.activeStates.map((state) => ({
        field_name: this.fieldMapping.stateField,
        operator: "is",
        value: [state],
      })),
    };

    const records = await this.api.searchRecords(filter);
    logger.debug({ count: records.length }, "Fetched candidate issues from Feishu");
    return records.map((r) => mapRecordToIssue(r, this.fieldMapping));
  }

  async fetchIssuesByStates(states: string[]): Promise<Issue[]> {
    if (states.length === 0) return [];
    if (states.length === 1 && states[0] === "*") {
      const records = await this.api.listRecords();
      return records.map((r) => mapRecordToIssue(r, this.fieldMapping));
    }

    const filter = {
      conjunction: "or" as const,
      conditions: states.map((state) => ({
        field_name: this.fieldMapping.stateField,
        operator: "is",
        value: [state.trim()],
      })),
    };

    const records = await this.api.searchRecords(filter);
    return records.map((r) => mapRecordToIssue(r, this.fieldMapping));
  }

  async fetchIssueStatesByIds(ids: string[]): Promise<Issue[]> {
    if (ids.length === 0) return [];

    // record_id is not filterable via search, fetch all and filter client-side
    const records = await this.api.listRecords();
    const idSet = new Set(ids);
    return records
      .filter((r) => idSet.has(r.record_id))
      .map((r) => mapRecordToIssue(r, this.fieldMapping));
  }

  async updateIssueState(issueId: string, state: string): Promise<void> {
    await this.api.updateRecord(issueId, { [this.fieldMapping.stateField]: state });
    logger.info({ issueId, state }, "Updated issue state in tracker");
  }

  async updateIssueTokens(issueId: string, tokens: TokenUsage): Promise<void> {
    if (!this.tokensField) return;
    await this.api.updateRecord(issueId, { [this.tokensField]: tokens.totalTokens });
    logger.info({ issueId, totalTokens: tokens.totalTokens }, "Updated issue tokens in tracker");
  }

  async updateIssueJoinCommand(issueId: string, command: string): Promise<void> {
    if (!this.joinCommandField) return;
    await this.api.updateRecord(issueId, { [this.joinCommandField]: command });
    logger.info({ issueId }, "Updated issue join command in tracker");
  }

  async updateIssueProgress(issueId: string, progress: string): Promise<void> {
    if (!this.progressField) return;
    await this.api.updateRecord(issueId, { [this.progressField]: progress });
    logger.info({ issueId, progress }, "Updated issue progress in tracker");
  }

  async updateIssueResultSummary(issueId: string, summary: string): Promise<void> {
    if (!this.resultSummaryField) return;
    await this.api.updateRecord(issueId, { [this.resultSummaryField]: summary });
    logger.info({ issueId }, "Updated issue result summary in tracker");
  }

  getMcpServerConfig(issueId: string): Record<string, McpServerConfig> {
    const trackerMcpServer = createTrackerMcpServer(this, issueId);
    return { tracker: trackerMcpServer };
  }

  async createIssue(data: CreateIssueData): Promise<Issue> {
    const fields: Record<string, unknown> = {
      [this.fieldMapping.titleField]: data.title,
    };
    if (data.description) {
      fields[this.fieldMapping.descriptionField] = data.description;
    }
    if (data.state) {
      fields[this.fieldMapping.stateField] = data.state;
    }
    const record = await this.api.createRecord(fields);
    return mapRecordToIssue(record, this.fieldMapping);
  }

  async searchIssues(query: string): Promise<Issue[]> {
    const filter = {
      conjunction: "and" as const,
      conditions: [
        {
          field_name: this.fieldMapping.titleField,
          operator: "contains",
          value: [query],
        },
      ],
    };
    const records = await this.api.searchRecords(filter);
    return records.map((r) => mapRecordToIssue(r, this.fieldMapping));
  }

  async healthCheck(): Promise<HealthCheckResult[]> {
    const results: HealthCheckResult[] = [];

    try {
      await this.auth.getAccessToken();
      results.push({ name: "Feishu auth", status: "pass", message: "Credentials valid" });
    } catch (err) {
      results.push({ name: "Feishu auth", status: "fail", message: err instanceof Error ? err.message : String(err) });
      return results;
    }

    try {
      await this.api.listRecords(1);
      results.push({ name: "Bitable access", status: "pass", message: "Table accessible" });
    } catch (err) {
      results.push({ name: "Bitable access", status: "fail", message: err instanceof Error ? err.message : String(err) });
    }

    return results;
  }

  getDashboardUrl(): string | null {
    return `https://mbyzmxekdm.feishu.cn/base/${this.api.appToken}?table=${this.api.tableId}`;
  }
}

export function createFeishuBitableAdapter(rawConfig: Record<string, unknown>): TrackerAdapter {
  return new FeishuBitableAdapter({
    appId: rawConfig.app_id as string,
    appSecret: rawConfig.app_secret as string,
    appToken: rawConfig.app_token as string,
    tableId: rawConfig.table_id as string,
    stateField: rawConfig.state_field as string,
    identifierField: rawConfig.identifier_field as string,
    titleField: rawConfig.title_field as string,
    descriptionField: (rawConfig.description_field as string) ?? "描述",
    priorityField: rawConfig.priority_field as string | undefined,
    labelsField: rawConfig.labels_field as string | undefined,
    tokensField: rawConfig.tokens_field as string | undefined,
    joinCommandField: rawConfig.join_command_field as string | undefined,
    progressField: rawConfig.progress_field as string | undefined,
    resultSummaryField: rawConfig.result_summary_field as string | undefined,
    activeStates: (rawConfig.active_states as string[]) ?? ["待处理", "进行中"],
    terminalStates: (rawConfig.terminal_states as string[]) ?? ["已完成", "已取消"],
  });
}
