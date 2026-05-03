/**
 * JSON File Tracker - Adapter 实现
 *
 * 核心适配器类，实现 TrackerAdapter 接口。
 * 这是连接 JSON 文件存储与 Orchestrator 调度器的桥梁。
 */

import type { TrackerAdapter } from "../../src/adapters/tracker/types.ts";
import type { Issue, TokenUsage } from "../../src/model/index.ts";
import { JsonTrackerApi } from "./api.ts";
import { mapRecordToIssue } from "./mapper.ts";
import type { JsonTrackerConfig } from "./types.ts";

export class JsonTrackerAdapter implements TrackerAdapter {
  readonly kind = "json_file";
  private readonly api: JsonTrackerApi;
  private readonly activeStates: string[];
  private readonly terminalStates: string[];

  constructor(config: JsonTrackerConfig) {
    this.api = new JsonTrackerApi(config);
    this.activeStates = config.activeStates.map((s) => s.trim());
    this.terminalStates = config.terminalStates.map((s) => s.trim());
    this.api.init();
  }

  /**
   * 获取候选任务（活跃状态的所有任务）
   * 对应 Orchestrator 的 tick 中的 "fetchCandidateIssues" 调用
   */
  async fetchCandidateIssues(): Promise<Issue[]> {
    const records = this.api.listRecordsByStates(this.activeStates);
    return records.map(mapRecordToIssue);
  }

  /**
   * 按状态列表获取任务
   * 用于启动时清理终态任务的工作目录
   */
  async fetchIssuesByStates(states: string[]): Promise<Issue[]> {
    const records = this.api.listRecordsByStates(states);
    return records.map(mapRecordToIssue);
  }

  /**
   * 按 ID 获取任务状态
   * 用于 reconcile 阶段检查运行中任务的最新状态
   */
  async fetchIssueStatesByIds(ids: string[]): Promise<Issue[]> {
    const records = this.api.getRecordsByIds(ids);
    return records.map(mapRecordToIssue);
  }

  /**
   * 更新任务状态
   * 用于分布式锁：dispatch 时标记为"进行中"，完成后标记为终态
   */
  async updateIssueState(issueId: string, state: string): Promise<void> {
    const result = this.api.updateRecord(issueId, { state });
    if (!result) {
      throw new Error(`Record not found: ${issueId}`);
    }
  }

  /**
   * 更新任务的 token 用量
   */
  async updateIssueTokens(issueId: string, tokens: TokenUsage): Promise<void> {
    // JSON tracker 不需要持久化 token 用量，但接口要求实现
    // 可以选择扩展 JsonTrackerRecord 添加 tokens 字段
    console.log(`[JsonTracker] Issue ${issueId} used ${tokens.totalTokens} tokens`);
  }
}

/**
 * 工厂函数：从配置对象创建适配器实例
 * 这个函数签名匹配 TrackerAdapterFactory 类型
 */
export function createJsonTrackerAdapter(rawConfig: Record<string, unknown>): TrackerAdapter {
  return new JsonTrackerAdapter({
    filePath: rawConfig.file_path as string,
    activeStates: (rawConfig.active_states as string[]) ?? ["待处理", "进行中"],
    terminalStates: (rawConfig.terminal_states as string[]) ?? ["已完成", "已取消"],
  });
}
