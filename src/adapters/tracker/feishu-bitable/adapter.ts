import type { TrackerAdapter } from "../types.ts";
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
    const trackerMcpServer = createTrackerMcpServer(this.api, issueId);
    return { tracker: trackerMcpServer };
  }
}

function str(val: unknown, fallback?: string): string | undefined {
  return typeof val === "string" ? val : fallback;
}

function strArr(val: unknown, fallback: string[]): string[] {
  return Array.isArray(val) && val.every((v) => typeof v === "string") ? val : fallback;
}

export function createFeishuBitableAdapter(rawConfig: Record<string, unknown>): TrackerAdapter {
  return new FeishuBitableAdapter({
    appId: str(rawConfig.app_id, "")!,
    appSecret: str(rawConfig.app_secret, "")!,
    appToken: str(rawConfig.app_token, "")!,
    tableId: str(rawConfig.table_id, "")!,
    stateField: str(rawConfig.state_field, "")!,
    identifierField: str(rawConfig.identifier_field, "")!,
    titleField: str(rawConfig.title_field, "")!,
    descriptionField: str(rawConfig.description_field, "描述"),
    priorityField: str(rawConfig.priority_field),
    labelsField: str(rawConfig.labels_field),
    tokensField: str(rawConfig.tokens_field),
    joinCommandField: str(rawConfig.join_command_field),
    progressField: str(rawConfig.progress_field),
    resultSummaryField: str(rawConfig.result_summary_field),
    activeStates: strArr(rawConfig.active_states, ["待处理", "进行中"]),
    terminalStates: strArr(rawConfig.terminal_states, ["已完成", "已取消"]),
  });
}
