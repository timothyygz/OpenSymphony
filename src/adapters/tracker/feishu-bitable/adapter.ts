import type { TrackerAdapter } from "../types.ts";
import type { Issue } from "../../../model/index.ts";
import { FeishuAuth } from "./auth.ts";
import { FeishuBitableApi } from "./api.ts";
import { mapRecordToIssue, type FieldMapping } from "./mapper.ts";
import { logger } from "../../../logging/logger.ts";

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
  activeStates: string[];
  terminalStates: string[];
}

export class FeishuBitableAdapter implements TrackerAdapter {
  readonly kind = "feishu_bitable";
  private readonly auth: FeishuAuth;
  private readonly api: FeishuBitableApi;
  private readonly fieldMapping: FieldMapping;
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
    activeStates: (rawConfig.active_states as string[]) ?? ["待处理", "进行中"],
    terminalStates: (rawConfig.terminal_states as string[]) ?? ["已完成", "已取消"],
  });
}
