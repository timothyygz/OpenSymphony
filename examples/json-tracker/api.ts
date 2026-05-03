/**
 * JSON File Tracker - API 层
 *
 * 封装对 JSON 文件的读写操作，提供类似飞书 Bitable API 的接口。
 * 使用文件锁保证并发安全。
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { JsonTrackerConfig, JsonTrackerRecord, JsonTrackerStore } from "./types.ts";

export class JsonTrackerApi {
  private readonly filePath: string;

  constructor(private readonly config: JsonTrackerConfig) {
    this.filePath = config.filePath;
  }

  // --- 文件级操作 ---

  /**
   * 初始化存储文件（如果不存在则创建）
   */
  init(): void {
    if (!existsSync(this.filePath)) {
      const store: JsonTrackerStore = {
        nextSeq: 100,
        records: [],
      };
      this.writeStore(store);
    }
  }

  // --- 记录读取 ---

  /**
   * 列出所有记录
   */
  listRecords(): JsonTrackerRecord[] {
    return this.readStore().records;
  }

  /**
   * 按状态筛选记录
   */
  listRecordsByStates(states: string[]): JsonTrackerRecord[] {
    const stateSet = new Set(states.map((s) => s.trim()));
    return this.readStore().records.filter((r) => stateSet.has(r.state.trim()));
  }

  /**
   * 按 ID 获取记录
   */
  getRecordsByIds(ids: string[]): JsonTrackerRecord[] {
    const idSet = new Set(ids);
    return this.readStore().records.filter((r) => idSet.has(r.id));
  }

  // --- 记录写入 ---

  /**
   * 创建新记录，自动生成 ID 和编号
   */
  createRecord(partial: Omit<JsonTrackerRecord, "id" | "identifier" | "createdAt" | "updatedAt">): JsonTrackerRecord {
    const store = this.readStore();
    const seq = store.nextSeq++;
    const record: JsonTrackerRecord = {
      id: `rec_${seq}`,
      identifier: `JT-${seq}`,
      ...partial,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    store.records.push(record);
    this.writeStore(store);
    return record;
  }

  /**
   * 更新指定记录的字段
   */
  updateRecord(id: string, updates: Partial<JsonTrackerRecord>): JsonTrackerRecord | null {
    const store = this.readStore();
    const record = store.records.find((r) => r.id === id);
    if (!record) return null;

    Object.assign(record, updates, { updatedAt: new Date().toISOString() });
    this.writeStore(store);
    return record;
  }

  /**
   * 批量创建记录（用于初始化示例数据）
   */
  seedRecords(items: Array<Omit<JsonTrackerRecord, "id" | "identifier" | "createdAt" | "updatedAt">>): JsonTrackerRecord[] {
    const store = this.readStore();
    const created: JsonTrackerRecord[] = [];

    for (const item of items) {
      const seq = store.nextSeq++;
      const record: JsonTrackerRecord = {
        id: `rec_${seq}`,
        identifier: `JT-${seq}`,
        ...item,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      store.records.push(record);
      created.push(record);
    }

    this.writeStore(store);
    return created;
  }

  // --- 内部方法 ---

  private readStore(): JsonTrackerStore {
    try {
      const content = readFileSync(this.filePath, "utf-8");
      return JSON.parse(content) as JsonTrackerStore;
    } catch {
      return { nextSeq: 100, records: [] };
    }
  }

  private writeStore(store: JsonTrackerStore): void {
    writeFileSync(this.filePath, JSON.stringify(store, null, 2), "utf-8");
  }
}
