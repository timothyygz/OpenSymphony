# Tracker 适配器开发教程

本教程将指导你从零开发一个 Tracker 适配器，接入 Symphony 编排系统。你将理解 Tracker 的架构设计、接口契约、开发流程，并通过一个完整的 JSON File Tracker 示例掌握所有细节。

---

## 目录

1. [架构概览](#1-架构概览)
2. [核心概念](#2-核心概念)
3. [TrackerAdapter 接口契约](#3-trackeradapter-接口契约)
4. [开发流程](#4-开发流程)
5. [Step 1: 定义数据模型](#5-step-1-定义数据模型)
6. [Step 2: 实现 API 层](#6-step-2-实现-api-层)
7. [Step 3: 实现数据映射](#7-step-3-实现数据映射)
8. [Step 4: 实现 Adapter](#8-step-4-实现-adapter)
9. [Step 5: 注册到 Registry](#9-step-5-注册到-registry)
10. [Step 6: 配置 WORKFLOW.md](#10-step-6-配置-workflowmd)
11. [Step 7: 编写测试](#11-step-7-编写测试)
12. [完整示例: JSON File Tracker](#12-完整示例-json-file-tracker)
13. [进阶: 对接真实系统](#13-进阶对接真实系统)
14. [常见问题](#14-常见问题)

---

## 1. 架构概览

Symphony 使用可插拔的适配器架构，将"任务从哪来"与"任务怎么执行"解耦：

```
WORKFLOW.md ──▶ Workflow Loader ──▶ Config ──▶ Orchestrator
                                               │
                              ┌────────────────┤
                              ▼                ▼
                        TrackerAdapter   AgentAdapter
                        (任务来源)        (执行引擎)
                              │                │
                              ▼                ▼
                     飞书多维表格         Claude Code
                     JSON 文件           OpenAI Codex
                     Linear             ...可扩展
                     Jira
                     ...可扩展
```

**Tracker 适配器**负责：
- 从外部系统拉取待处理任务
- 按 ID 查询任务最新状态
- 更新任务状态（分布式锁）
- 记录 token 用量

### 状态流转模型

```
                    ┌─── activeStates ───┐
                    │                    │
                    ▼                    │
  [创建] ──▶ 待处理 ──(dispatch)──▶ 进行中 ──(完成)──▶ 已完成
                    ▲                    │                    ▲
                    │                    │                    │
                    └──(失败/重试)────────┘              terminalStates
```

- **活跃状态 (activeStates)**: 可以被 Orchestrator 调度的状态（如"待处理"、"进行中"）
- **终态 (terminalStates)**: 任务已完成，不再处理（如"已完成"、"已取消"）

---

## 2. 核心概念

### 2.1 Issue 模型

所有 Tracker 适配器最终都映射为统一的 `Issue` 模型：

```typescript
// src/model/issue.ts
interface Issue {
  id: string;              // 唯一标识（对应外部系统的记录 ID）
  identifier: string;      // 人类可读编号（如 "JT-100"、"MT-100"）
  title: string;           // 任务标题
  description: string | null;  // 任务描述
  priority: number | null;     // 优先级（数字越小越高）
  state: string;               // 当前状态
  branchName: string | null;   // 关联分支名
  url: string | null;          // 外部系统链接
  labels: string[];            // 标签列表
  blockedBy: BlockerRef[];     // 阻塞依赖
  createdAt: Date | null;      // 创建时间
  updatedAt: Date | null;      // 更新时间
}
```

### 2.2 Adapter 接口

```typescript
// src/adapters/tracker/types.ts
interface TrackerAdapter {
  readonly kind: string;
  fetchCandidateIssues(): Promise<Issue[]>;
  fetchIssuesByStates(states: string[]): Promise<Issue[]>;
  fetchIssueStatesByIds(ids: string[]): Promise<Issue[]>;
  updateIssueState(issueId: string, state: string): Promise<void>;
  updateIssueTokens(issueId: string, tokens: TokenUsage): Promise<void>;
}
```

### 2.3 Registry 注册表

Symphony 使用全局注册表管理所有适配器：

```typescript
// 注册
registerTracker("json_file", createJsonTrackerAdapter);

// 创建
const tracker = createTracker("json_file", config);
```

### 2.4 配置透传

`WORKFLOW.md` 中 `tracker:` 下的所有字段会原样传递给适配器工厂函数：

```yaml
tracker:
  kind: json_file           # 用于路由到正确的适配器
  file_path: "./data.json"  # 以下字段透传给工厂函数
  active_states: ["待处理"]
  terminal_states: ["已完成"]
```

---

## 3. TrackerAdapter 接口契约

每个方法在 Orchestrator 中的调用时机和语义要求：

| 方法 | 调用时机 | 语义要求 |
|------|---------|---------|
| `fetchCandidateIssues()` | 每个 tick 周期 | 返回所有活跃状态的任务，用于调度 |
| `fetchIssuesByStates(states)` | 启动时、reconcile | 返回指定状态的任务 |
| `fetchIssueStatesByIds(ids)` | Worker turn 结束后 | 按 ID 返回任务最新状态 |
| `updateIssueState(id, state)` | dispatch/完成/失败时 | 更新任务状态，实现分布式锁 |
| `updateIssueTokens(id, tokens)` | Worker 退出时 | 记录 token 用量 |

### 调用时序图

```
Orchestrator          TrackerAdapter          AgentAdapter
     │                      │                      │
     │  tick()              │                      │
     ├──────────────────────┤                      │
     │                      │                      │
     │  fetchCandidateIssues()                     │
     ├─────────────────────►│                      │
     │◄───── [Issue] ───────┤                      │
     │                      │                      │
     │  updateIssueState(id, "进行中")  ← 分布式锁   │
     ├─────────────────────►│                      │
     │                      │                      │
     │  startSession()      │              startSession()
     ├──────────────────────┼─────────────────────►│
     │                      │                      │
     │  runTurn() × N       │                runTurn()
     ├──────────────────────┼─────────────────────►│
     │                      │                      │
     │  fetchIssueStatesByIds()  ← reconcile      │
     ├─────────────────────►│                      │
     │◄───── [Issue] ───────┤                      │
     │                      │                      │
     │  updateIssueState(id, "已完成")              │
     ├─────────────────────►│                      │
     │                      │                      │
     │  updateIssueTokens(id, tokens)              │
     ├─────────────────────►│                      │
```

---

## 4. 开发流程

开发一个新的 Tracker 适配器遵循以下 7 步流程：

```
Step 1: 定义数据模型       → 确定外部系统的数据结构
Step 2: 实现 API 层        → 封装与外部系统的通信
Step 3: 实现数据映射        → 外部模型 → Issue 模型
Step 4: 实现 Adapter       → 组合 API + 映射，实现接口
Step 5: 注册到 Registry    → 一行代码完成注册
Step 6: 配置 WORKFLOW.md   → 编写 YAML 配置 + Prompt 模板
Step 7: 编写测试            → API / Mapper / Adapter 三层测试
```

### 文件结构约定

```
src/adapters/tracker/
├── types.ts                    # TrackerAdapter 接口定义
├── registry.ts                 # 全局注册表
└── your-tracker/               # 你的适配器目录
    ├── types.ts                # Step 1: 数据模型
    ├── api.ts                  # Step 2: API 层
    ├── mapper.ts               # Step 3: 数据映射
    ├── adapter.ts              # Step 4: Adapter 实现
    └── register.ts             # Step 5: 注册入口
```

---

## 5. Step 1: 定义数据模型

首先定义外部系统的数据结构。以 JSON File Tracker 为例：

```typescript
// examples/json-tracker/types.ts

/** JSON 文件中的单条任务记录 */
export interface JsonTrackerRecord {
  id: string;
  identifier: string;       // 如 "JT-100"
  title: string;
  description: string | null;
  priority: number | null;
  state: string;
  labels: string[];
  createdAt: string;        // ISO 字符串
  updatedAt: string;
}

/** JSON 文件的完整结构 */
export interface JsonTrackerStore {
  nextSeq: number;          // 自增序号
  records: JsonTrackerRecord[];
}

/** 适配器配置 */
export interface JsonTrackerConfig {
  filePath: string;
  activeStates: string[];
  terminalStates: string[];
}
```

**设计要点：**
- 每条记录必须有唯一 `id`（用于 Orchestrator 跟踪）
- 状态用字符串表示，由配置决定哪些是活跃/终态
- 配置接口应包含适配器运行所需的所有参数

---

## 6. Step 2: 实现 API 层

API 层封装与外部系统的通信，提供 CRUD 接口：

```typescript
// examples/json-tracker/api.ts

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { JsonTrackerConfig, JsonTrackerRecord, JsonTrackerStore } from "./types.ts";

export class JsonTrackerApi {
  private readonly filePath: string;

  constructor(private readonly config: JsonTrackerConfig) {
    this.filePath = config.filePath;
  }

  /** 初始化存储（如果不存在） */
  init(): void {
    if (!existsSync(this.filePath)) {
      this.writeStore({ nextSeq: 100, records: [] });
    }
  }

  /** 列出所有记录 */
  listRecords(): JsonTrackerRecord[] {
    return this.readStore().records;
  }

  /** 按状态筛选 */
  listRecordsByStates(states: string[]): JsonTrackerRecord[] {
    const stateSet = new Set(states.map(s => s.trim()));
    return this.readStore().records.filter(r => stateSet.has(r.state.trim()));
  }

  /** 按 ID 获取 */
  getRecordsByIds(ids: string[]): JsonTrackerRecord[] {
    const idSet = new Set(ids);
    return this.readStore().records.filter(r => idSet.has(r.id));
  }

  /** 创建记录 */
  createRecord(partial: Omit<JsonTrackerRecord, 'id' | 'identifier' | 'createdAt' | 'updatedAt'>): JsonTrackerRecord {
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

  /** 更新记录 */
  updateRecord(id: string, updates: Partial<JsonTrackerRecord>): JsonTrackerRecord | null {
    const store = this.readStore();
    const record = store.records.find(r => r.id === id);
    if (!record) return null;
    Object.assign(record, updates, { updatedAt: new Date().toISOString() });
    this.writeStore(store);
    return record;
  }

  private readStore(): JsonTrackerStore {
    try {
      return JSON.parse(readFileSync(this.filePath, 'utf-8'));
    } catch {
      return { nextSeq: 100, records: [] };
    }
  }

  private writeStore(store: JsonTrackerStore): void {
    writeFileSync(this.filePath, JSON.stringify(store, null, 2), 'utf-8');
  }
}
```

**设计要点：**
- API 层只关心数据的读写，不关心业务逻辑
- `init()` 方法确保存储存在，适配器构造时调用
- 错误处理要健壮：读取失败时返回空数据而非抛异常

---

## 7. Step 3: 实现数据映射

映射层将外部系统的记录转换为统一的 `Issue` 模型：

```typescript
// examples/json-tracker/mapper.ts

import type { Issue } from "../../src/model/index.ts";
import type { JsonTrackerRecord } from "./types.ts";

export function mapRecordToIssue(record: JsonTrackerRecord): Issue {
  return {
    id: record.id,
    identifier: record.identifier,
    title: record.title,
    description: record.description,
    priority: record.priority,
    state: record.state,
    branchName: null,        // JSON tracker 不支持
    url: null,               // JSON tracker 不支持
    labels: record.labels.map(l => l.toLowerCase()),
    blockedBy: [],           // JSON tracker 不支持
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };
}
```

**设计要点：**
- 映射函数应当是纯函数，无副作用
- 不支持的字段设为 `null` 或空数组
- 标签统一转小写，保持一致性
- 时间戳统一转为 `Date` 对象

参考飞书多维表格的映射层（处理更复杂的富文本格式）：

```typescript
// src/adapters/tracker/feishu-bitable/mapper.ts（节选）

function extractString(value: unknown): string | null {
  if (typeof value === "string") return value.trim();
  // 飞书富文本: [{text: "hello"}, {text: "world"}]
  if (Array.isArray(value)) {
    return value.map(item => {
      if (typeof item === "string") return item;
      if (typeof item === "object" && "text" in item) return String(item.text);
      return "";
    }).join("").trim() || null;
  }
  // ...更多格式处理
}
```

---

## 8. Step 4: 实现 Adapter

Adapter 是核心类，组合 API 层和映射层，实现 `TrackerAdapter` 接口：

```typescript
// examples/json-tracker/adapter.ts

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
    this.activeStates = config.activeStates.map(s => s.trim());
    this.terminalStates = config.terminalStates.map(s => s.trim());
    this.api.init();  // 确保存储存在
  }

  async fetchCandidateIssues(): Promise<Issue[]> {
    const records = this.api.listRecordsByStates(this.activeStates);
    return records.map(mapRecordToIssue);
  }

  async fetchIssuesByStates(states: string[]): Promise<Issue[]> {
    const records = this.api.listRecordsByStates(states);
    return records.map(mapRecordToIssue);
  }

  async fetchIssueStatesByIds(ids: string[]): Promise<Issue[]> {
    const records = this.api.getRecordsByIds(ids);
    return records.map(mapRecordToIssue);
  }

  async updateIssueState(issueId: string, state: string): Promise<void> {
    const result = this.api.updateRecord(issueId, { state });
    if (!result) throw new Error(`Record not found: ${issueId}`);
  }

  async updateIssueTokens(issueId: string, tokens: TokenUsage): Promise<void> {
    // 可选：持久化 token 用量到存储中
    console.log(`[JsonTracker] Issue ${issueId} used ${tokens.totalTokens} tokens`);
  }
}

/** 工厂函数：从原始配置创建适配器 */
export function createJsonTrackerAdapter(rawConfig: Record<string, unknown>): TrackerAdapter {
  return new JsonTrackerAdapter({
    filePath: rawConfig.file_path as string,
    activeStates: (rawConfig.active_states as string[]) ?? ["待处理", "进行中"],
    terminalStates: (rawConfig.terminal_states as string[]) ?? ["已完成", "已取消"],
  });
}
```

**设计要点：**
- 工厂函数签名必须是 `(config: Record<string, unknown>) => TrackerAdapter`
- 配置字段使用 snake_case（与 YAML 配置一致），在工厂函数中转换
- `init()` 在构造函数中调用，确保首次使用前存储就绪
- 所有方法返回 `Promise`（即使内部是同步操作），保持接口一致性

---

## 9. Step 5: 注册到 Registry

创建 `register.ts` 文件，一行代码完成注册：

```typescript
// examples/json-tracker/register.ts

import { registerTracker } from "../../src/adapters/tracker/registry.ts";
import { createJsonTrackerAdapter } from "./adapter.ts";

registerTracker("json_file", createJsonTrackerAdapter);
```

然后在 `cli.ts` 中导入：

```typescript
// src/cli.ts（添加这一行）

// Register built-in adapters
await import("./adapters/tracker/feishu-bitable/register.ts");
await import("./adapters/agent/claude-code/register.ts");

// 注册自定义 Tracker
await import("../examples/json-tracker/register.ts");
```

---

## 10. Step 6: 配置 WORKFLOW.md

编写配置文件，`tracker:` 下的字段会透传给适配器工厂函数：

```yaml
---
tracker:
  kind: json_file              # 对应 registerTracker 的第一个参数
  file_path: "./tracker-data.json"  # 自定义字段
  active_states: ["待处理"]
  terminal_states: ["已完成", "已取消"]

polling:
  interval_ms: 5000            # 5秒轮询一次

workspace:
  root: "/tmp/symphony-json-tracker/workspaces"

agent:
  max_concurrent_agents: 3     # 最多同时执行3个任务
  max_turns: 5                 # 每个任务最多5轮
  max_retry_backoff_ms: 60000  # 重试退避上限60秒

codex:
  command: "claude"            # Agent 命令
---

You are an AI coding assistant working on issue {{ issue.identifier }}: {{ issue.title }}.

## Issue Description
{{ issue.description }}

## Instructions
1. Read the issue description carefully.
2. Implement the required changes.
3. Write tests for your changes.

{% if attempt %}
This is retry attempt #{{ attempt }}.
{% endif %}
```

### 配置字段说明

| 字段 | 说明 |
|------|------|
| `kind` | 适配器标识，必须与 `registerTracker` 的第一个参数一致 |
| `file_path` | (自定义) JSON 文件路径 |
| `active_states` | (自定义) 活跃状态列表 |
| `terminal_states` | (自定义) 终态列表 |
| `polling.interval_ms` | 轮询间隔（毫秒） |
| `agent.max_concurrent_agents` | 最大并发数 |
| `agent.max_turns` | 单任务最大轮数 |

---

## 11. Step 7: 编写测试

测试分三层：API 层、Mapper 层、Adapter 层。

### 测试文件结构

```
tests/examples/json-tracker.test.ts
```

### 测试示例

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { JsonTrackerApi } from "../../examples/json-tracker/api.ts";
import { JsonTrackerAdapter } from "../../examples/json-tracker/adapter.ts";
import { mapRecordToIssue } from "../../examples/json-tracker/mapper.ts";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "json-tracker-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// --- API 层测试 ---
describe("JsonTrackerApi", () => {
  it("createRecord auto-generates id and identifier", () => {
    const api = new JsonTrackerApi({ filePath: join(tempDir, "test.json"), activeStates: [], terminalStates: [] });
    api.init();
    const record = api.createRecord({ title: "Test", description: null, priority: 1, state: "待处理", labels: [] });
    expect(record.id).toBe("rec_100");
    expect(record.identifier).toBe("JT-100");
  });

  it("updateRecord modifies state", () => {
    const api = new JsonTrackerApi({ /* ... */ });
    api.init();
    const r = api.createRecord({ title: "Test", description: null, priority: null, state: "待处理", labels: [] });
    const updated = api.updateRecord(r.id, { state: "进行中" });
    expect(updated!.state).toBe("进行中");
  });
});

// --- Mapper 层测试 ---
describe("mapRecordToIssue", () => {
  it("maps all fields correctly", () => {
    const record = { id: "rec_100", identifier: "JT-100", title: "Test", description: "desc", priority: 1, state: "待处理", labels: ["Bug"], createdAt: "2026-01-15T10:00:00Z", updatedAt: "2026-01-15T11:00:00Z" };
    const issue = mapRecordToIssue(record);
    expect(issue.id).toBe("rec_100");
    expect(issue.labels).toEqual(["bug"]);  // 小写
  });
});

// --- Adapter 层测试 ---
describe("JsonTrackerAdapter", () => {
  it("fetchCandidateIssues returns only active issues", async () => {
    const api = new JsonTrackerApi({ /* ... */ });
    api.init();
    api.createRecord({ title: "Active", description: null, priority: null, state: "待处理", labels: [] });
    api.createRecord({ title: "Done", description: null, priority: null, state: "已完成", labels: [] });

    const adapter = new JsonTrackerAdapter({ filePath: join(tempDir, "test.json"), activeStates: ["待处理"], terminalStates: ["已完成"] });
    const issues = await adapter.fetchCandidateIssues();
    expect(issues).toHaveLength(1);
    expect(issues[0]!.title).toBe("Active");
  });
});
```

运行测试：

```bash
bun test tests/examples/json-tracker.test.ts
```

---

## 12. 完整示例: JSON File Tracker

本教程附带一个完整的、可运行的示例，位于 `examples/json-tracker/`：

```
examples/json-tracker/
├── types.ts          # 数据模型 + 配置接口
├── api.ts            # JSON 文件读写 API
├── mapper.ts         # Record → Issue 映射
├── adapter.ts        # TrackerAdapter 实现 + 工厂函数
├── register.ts       # 注册入口
├── seed.ts           # 初始化示例数据脚本
└── WORKFLOW.md       # 示例配置文件
```

### 运行示例

```bash
# 1. 初始化示例数据
cd examples/json-tracker
bun run seed.ts

# 输出：
# ✅ 已创建 5 条示例任务：
#    JT-100 [待处理] 修复登录页面样式错乱
#    JT-101 [待处理] 添加用户头像上传功能
#    JT-102 [待处理] 优化数据库查询性能
#    JT-103 [待处理] 编写 API 接口文档
#    JT-104 [已完成] 已完成的历史任务
#
# 📝 数据文件: ./tracker-data.json

# 2. 运行测试
cd ../..
bun test tests/examples/json-tracker.test.ts

# 输出：18 pass, 0 fail
```

### 数据文件格式

`seed.ts` 生成的 `tracker-data.json`：

```json
{
  "nextSeq": 105,
  "records": [
    {
      "id": "rec_100",
      "identifier": "JT-100",
      "title": "修复登录页面样式错乱",
      "description": "登录页面在移动端显示异常...",
      "priority": 1,
      "state": "待处理",
      "labels": ["bug", "frontend"],
      "createdAt": "2026-05-03T05:27:24.332Z",
      "updatedAt": "2026-05-03T05:27:24.332Z"
    }
  ]
}
```

---

## 13. 进阶: 对接真实系统

当你需要对接真实的任务管理系统（飞书、Linear、Jira、GitHub Issues 等）时，需要额外考虑：

### 13.1 认证

参考飞书多维表格的认证实现：

```typescript
// src/adapters/tracker/feishu-bitable/auth.ts

export class FeishuAuth {
  private token: string | null = null;
  private expiresAt = 0;

  constructor(private readonly appId: string, private readonly appSecret: string) {}

  async getAccessToken(): Promise<string> {
    if (this.token && Date.now() < this.expiresAt) {
      return this.token;  // 缓存未过期
    }
    return this.refresh();
  }

  private async refresh(): Promise<string> {
    const resp = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: this.appId, app_secret: this.appSecret }),
    });
    const data = await resp.json();
    this.token = data.tenant_access_token;
    this.expiresAt = Date.now() + (data.expire - 300) * 1000;  // 提前5分钟刷新
    return this.token;
  }
}
```

### 13.2 分页

真实 API 通常需要分页：

```typescript
async listRecords(pageSize = 50): Promise<BitableRecord[]> {
  const records: BitableRecord[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({ page_size: String(pageSize) });
    if (pageToken) params.set("page_token", pageToken);

    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await resp.json();

    if (data.data.items) records.push(...data.data.items);
    pageToken = data.data.has_more ? data.data.page_token : undefined;
  } while (pageToken);

  return records;
}
```

### 13.3 错误处理

```typescript
async updateIssueState(issueId: string, state: string): Promise<void> {
  const resp = await fetch(url, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { [this.stateField]: state } }),
  });

  if (!resp.ok) {
    throw new TrackerApiError(`HTTP ${resp.status}: ${await resp.text()}`, resp.status);
  }

  const data = await resp.json();
  if (data.code !== 0) {
    throw new TrackerApiError(`API error: code=${data.code} msg=${data.msg}`);
  }
}
```

### 13.4 复杂字段映射

真实系统的字段格式可能很复杂（飞书多维表格的富文本字段）：

```typescript
// 处理飞书富文本格式
function extractString(value: unknown): string | null {
  if (typeof value === "string") return value.trim();
  // [{text: "hello"}, {text: "world"}]
  if (Array.isArray(value)) {
    return value.map(item => {
      if (typeof item === "string") return item;
      if (typeof item === "object" && "text" in item) return String(item.text);
      return "";
    }).join("").trim() || null;
  }
  // {text: [{text: "hello"}]}
  if (typeof value === "object" && value !== null && "text" in value) {
    const text = (value as any).text;
    if (Array.isArray(text)) return text.map(t => t.text).join("");
    if (typeof text === "string") return text;
  }
  return String(value);
}
```

### 13.5 配置校验扩展

在 `validateDispatchConfig` 中添加你的适配器校验：

```typescript
// src/workflow/config.ts

if (config.tracker.kind === "json_file") {
  if (!config.tracker.file_path) return "tracker.file_path is required for json_file";
}
```

---

## 14. 常见问题

### Q: 我的 Tracker 需要支持 Webhook 而不是轮询怎么办？

目前 Orchestrator 使用轮询模式。你可以：
1. 保持轮询，在 `fetchCandidateIssues()` 中从你的系统拉取数据
2. 未来版本计划支持 Webhook 触发模式

### Q: 如何处理 Tracker API 限流？

在 API 层实现限流：
```typescript
private async throttleRequest<T>(fn: () => Promise<T>): Promise<T> {
  await this.rateLimiter.acquire();
  return fn();
}
```

### Q: 多实例部署时如何避免重复调度？

通过 `updateIssueState()` 实现分布式锁：
- dispatch 时立即将状态从"待处理"改为"进行中"
- 其他实例拉取时不会获取"进行中"的任务

### Q: 如何支持任务间的依赖关系？

在 `Issue.blockedBy` 字段中返回依赖列表，Orchestrator 会在调度时检查。

### Q: 测试中如何 Mock Tracker？

参考 `tests/orchestrator/orchestrator.test.ts` 中的 `MockTracker`：

```typescript
class MockTracker implements TrackerAdapter {
  kind = "mock";
  private issues: Issue[] = [];

  setIssues(issues: Issue[]) { this.issues = issues; }

  async fetchCandidateIssues(): Promise<Issue[]> { return this.issues; }
  async fetchIssuesByStates(): Promise<Issue[]> { return this.issues; }
  async updateIssueState(): Promise<void> {}
  async updateIssueTokens(): Promise<void> {}
  async fetchIssueStatesByIds(ids: string[]): Promise<Issue[]> {
    return this.issues.filter(i => ids.includes(i.id));
  }
}
```

---

## 文件清单

| 文件 | 说明 |
|------|------|
| `docs/tracker-tutorial.md` | 本教程 |
| `examples/json-tracker/types.ts` | 数据模型定义 |
| `examples/json-tracker/api.ts` | JSON 文件 API 层 |
| `examples/json-tracker/mapper.ts` | 数据映射层 |
| `examples/json-tracker/adapter.ts` | TrackerAdapter 实现 |
| `examples/json-tracker/register.ts` | 注册入口 |
| `examples/json-tracker/seed.ts` | 示例数据初始化脚本 |
| `examples/json-tracker/WORKFLOW.md` | 示例配置文件 |
| `tests/examples/json-tracker.test.ts` | 完整测试（18 个用例） |
