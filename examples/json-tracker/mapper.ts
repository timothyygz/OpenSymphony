/**
 * JSON File Tracker - 数据映射层
 *
 * 将 JSON 存储的记录映射为标准的 Issue 模型。
 * 这一层隔离了存储格式与业务模型之间的差异。
 */

import type { Issue } from "../../src/model/index.ts";
import type { JsonTrackerRecord } from "./types.ts";

/**
 * 将 JsonTrackerRecord 转换为标准 Issue
 */
export function mapRecordToIssue(record: JsonTrackerRecord): Issue {
  return {
    id: record.id,
    identifier: record.identifier,
    title: record.title,
    description: record.description,
    priority: record.priority,
    state: record.state,
    branchName: null,
    url: null,
    labels: record.labels.map((l) => l.toLowerCase()),
    blockedBy: [],
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };
}
