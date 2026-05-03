/**
 * JSON File Tracker - 示例 Tracker 适配器
 *
 * 使用一个 JSON 文件作为任务存储，模拟飞书多维表格的行为。
 * 适用于开发、测试和教学目的。
 */

// ============================================================
// Step 1: 定义数据模型
// ============================================================

/**
 * JSON 文件中的单条任务记录
 */
export interface JsonTrackerRecord {
  /** 唯一 ID */
  id: string;
  /** 任务编号，如 "JT-100" */
  identifier: string;
  /** 任务标题 */
  title: string;
  /** 任务描述 */
  description: string | null;
  /** 优先级（数字越小优先级越高） */
  priority: number | null;
  /** 任务状态 */
  state: string;
  /** 标签列表 */
  labels: string[];
  /** 创建时间（ISO 字符串） */
  createdAt: string;
  /** 更新时间（ISO 字符串） */
  updatedAt: string;
}

/**
 * JSON 文件的完整结构
 */
export interface JsonTrackerStore {
  /** 下一个编号的序号 */
  nextSeq: number;
  /** 所有任务记录 */
  records: JsonTrackerRecord[];
}

// ============================================================
// Step 2: 定义配置接口
// ============================================================

/**
 * JSON Tracker 的配置
 */
export interface JsonTrackerConfig {
  /** JSON 文件路径 */
  filePath: string;
  /** 活跃状态列表（可被调度的状态） */
  activeStates: string[];
  /** 终态列表（任务结束状态） */
  terminalStates: string[];
}
