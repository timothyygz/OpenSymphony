# Symphony Service v1 - Design

## 1. 项目结构

```
symphony-demo/
├── package.json                    # root workspace
├── tsconfig.json                   # strict, ESNext
├── bunfig.toml
├── src/
│   ├── cli.ts                      # 入口：解析 CLI 参数，启动服务
│   ├── orchestrator/
│   │   ├── orchestrator.ts         # 主循环：poll / dispatch / reconcile
│   │   ├── state.ts                # 运行时状态（running, claimed, retry, completed）
│   │   ├── retry.ts                # 指数退避重试队列
│   │   └── scheduler.ts            # tick 调度 + config 热加载触发
│   ├── workflow/
│   │   ├── loader.ts               # WORKFLOW.md 解析（front matter + body）
│   │   ├── config.ts               # Zod schema + 类型化配置 + 默认值 + $VAR 解析
│   │   ├── watcher.ts              # 文件监听，触发 reload
│   │   └── prompt.ts               # 模板渲染（issue + attempt 变量）
│   ├── workspace/
│   │   ├── manager.ts              # 创建/复用/清理 workspace
│   │   ├── hooks.ts                # after_create / before_run / after_run / before_remove
│   │   └── safety.ts               # 路径安全校验（root containment, key sanitize）
│   ├── adapters/
│   │   ├── agent/
│   │   │   ├── types.ts            # AgentAdapter interface
│   │   │   ├── registry.ts         # adapter 注册表 + dynamic import 加载
│   │   │   └── claude-code/
│   │   │       ├── adapter.ts      # Claude Code CLI adapter
│   │   │       ├── process.ts      # 子进程管理
│   │   │       └── parser.ts       # 输出解析（stream-json）
│   │   └── tracker/
│   │       ├── types.ts            # TrackerAdapter interface
│   │       ├── registry.ts         # adapter 注册表
│   │       └── feishu-bitable/
│   │           ├── adapter.ts      # 飞书多维表格 adapter
│   │           ├── auth.ts         # tenant_access_token 获取/刷新
│   │           ├── api.ts          # REST API 封装（list/search/records）
│   │           └── mapper.ts       # record → Issue 映射
│   ├── model/
│   │   ├── issue.ts                # Issue / BlockerRef 类型
│   │   ├── workflow.ts             # WorkflowDefinition / ServiceConfig 类型
│   │   ├── workspace.ts            # Workspace / RunAttempt 类型
│   │   └── session.ts              # LiveSession / RetryEntry 类型
│   ├── logging/
│   │   └── logger.ts               # pino 结构化日志
│   └── errors/
│       └── errors.ts               # 类型化错误类
├── WORKFLOW.md                     # 示例 workflow 文件
└── tests/
    ├── orchestrator/
    ├── workflow/
    ├── workspace/
    └── adapters/
```

不使用 monorepo packages —— 第一版只有 2 个 adapter（claude-code + feishu-bitable），
拆 packages 是过早抽象。所有 adapter 放在 `src/adapters/` 下，通过 registry +
interface 实现可插拔。未来 adapter 变多时再拆包。

## 2. 核心接口设计

### 2.1 Agent Adapter

```typescript
interface AgentAdapter {
  readonly kind: string;

  startSession(ctx: AgentSessionContext): Promise<AgentSession>;

  runTurn(
    session: AgentSession,
    prompt: string,
    onEvent: (event: AgentEvent) => void
  ): Promise<TurnResult>;

  stopSession(session: AgentSession): Promise<void>;
}

interface AgentSessionContext {
  workspacePath: string;
  config: AgentConfig;          // 从 WORKFLOW.md agent.* 配置解析
  issue: Issue;
  sessionId: string;
}

interface AgentSession {
  id: string;
  process?: ChildProcess;
  threadId?: string;
  metadata: Record<string, unknown>;
}

interface TurnResult {
  status: 'completed' | 'failed' | 'timed_out' | 'cancelled';
  error?: string;
  usage?: TokenUsage;
}

interface AgentEvent {
  event: string;
  timestamp: string;
  message?: string;
  usage?: TokenUsage;
  rateLimits?: unknown;
}

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}
```

### 2.2 Tracker Adapter

```typescript
interface TrackerAdapter {
  readonly kind: string;

  fetchCandidateIssues(): Promise<Issue[]>;
  fetchIssuesByStates(states: string[]): Promise<Issue[]>;
  fetchIssueStatesByIds(ids: string[]): Promise<Issue[]>;
}
```

### 2.3 Adapter Registry

```typescript
type AgentAdapterFactory = (config: Record<string, unknown>) => AgentAdapter;
type TrackerAdapterFactory = (config: Record<string, unknown>) => TrackerAdapter;

const adapterRegistry = {
  agents: new Map<string, AgentAdapterFactory>(),
  trackers: new Map<string, TrackerAdapterFactory>(),

  registerAgent(kind: string, factory: AgentAdapterFactory): void;
  registerTracker(kind: string, factory: TrackerAdapterFactory): void;

  createAgent(kind: string, config: Record<string, unknown>): AgentAdapter;
  createTracker(kind: string, config: Record<string, unknown>): TrackerAdapter;
};
```

内置 adapter 在启动时自注册。未来外部 adapter 可通过 dynamic import() 加载：

```typescript
// 未来扩展（v1 不实现）
async function loadExternalAdapter(specifier: string) {
  const mod = await import(specifier);
  mod.register(adapterRegistry);
}
```

## 3. Claude Code Adapter 设计

### 3.1 通信模型

Claude Code 没有 Codex 的 app-server 驻留进程模式。适配方式：

```
┌───────────────────────────────────────────────┐
│  Spec 期望的模型          Claude Code 实际模型  │
│                                               │
│  app-server 进程 ←─ stdio ─→ client           │
│  一个 thread 内多个 turn      每个独立进程调用   │
│  驻留 session                无状态 invocation │
│                                               │
│  适配策略：                                    │
│  · 1 个 turn = 1 次 `claude -p` 调用           │
│  · continuation = `claude --continue`          │
│  · session 元数据存在文件系统中                  │
│  · output-format: stream-json 解析事件         │
└───────────────────────────────────────────────┘
```

### 3.2 Session 关联机制

Claude Code `--continue` 的会话关联方式：

- **默认行为**：`--continue` 会续接当前目录下最近一次 Claude Code 会话
- **并行安全性**：每个 issue 独立 workspace，`claude -p` 指定 `cwd` 为对应 workspace 路径。
  不同 issue 在不同目录下运行，session 互不干扰
- **显式关联**（如果默认行为不安全）：使用 `claude --resume <session-id>` 指定会话。
  第一个 turn 结束后从输出中提取 session-id，后续 turn 用 `--resume` 传入

```
┌─────────────────────────────────────────────┐
│  workspace A (MT-100)    workspace B (MT-101)│
│  ┌─────────────────┐    ┌─────────────────┐  │
│  │ turn 1:          │    │ turn 1:          │  │
│  │  claude -p ...   │    │  claude -p ...   │  │
│  │  cwd=/ws/MT-100  │    │  cwd=/ws/MT-101  │  │
│  │                  │    │                  │  │
│  │ turn 2:          │    │ turn 2:          │  │
│  │  claude          │    │  claude          │  │
│  │   --continue     │    │   --continue     │  │
│  │   -p "..."       │    │   -p "..."       │  │
│  │  cwd=/ws/MT-100  │    │  cwd=/ws/MT-101  │  │
│  └─────────────────┘    └─────────────────┘  │
│  会话隔离（不同 cwd → 不同 session）           │
└─────────────────────────────────────────────┘
```

**⚠️ 待验证**：`--continue` 是否真的按 cwd 隔离会话。
如果不是，需要改用 `--resume <session-id>` 模式。在 T16 实现时首先验证此行为。

### 3.3 Turn 执行流程

```
worker 启动 (run_agent_attempt)
  │
  ├── turn 1: claude -p "<full rendered prompt>" --output-format stream-json
  │   ├── 解析 stream-json 输出 → AgentEvent (回调到 orchestrator)
  │   ├── turn 完成
  │   ├── worker 调用 tracker.fetchIssueStatesByIds([issue.id]) 刷新状态
  │   └── issue 仍 active 且 turn < max_turns → 继续
  │
  ├── turn 2: claude --continue -p "<continuation guidance>" --output-format stream-json
  │   ├── continuation guidance（见 3.4）
  │   ├── 解析输出 → AgentEvent
  │   ├── turn 完成 → 刷新 issue 状态
  │   └── issue 仍 active 且 turn < max_turns → 继续
  │
  ├── ... turn N: 同上
  │
  └── worker 正常退出 → orchestrator 处理 (schedule continuation retry)
```

**turn loop 内的 issue 状态刷新是 worker attempt 函数的职责**（Spec Section 16.5），
不是 AgentAdapter 的职责。AgentAdapter 只负责执行单个 turn。

### 3.4 Continuation Prompt 内容

Spec 要求 continuation turn 不重发原始 prompt。Claude Code 的 continuation prompt 内容：

```typescript
function buildTurnPrompt(
  template: string,
  issue: Issue,
  attempt: number | null,
  turnNumber: number,
): string {
  if (turnNumber === 1) {
    // 首次 turn：渲染完整 WORKFLOW.md 模板
    return renderTemplate(template, { issue, attempt });
  }
  // continuation turn：简短 guidance
  return [
    `Continuing work on ${issue.identifier}: ${issue.title}.`,
    `Current state: ${issue.state}.`,
    attempt ? `This is retry attempt #${attempt}.` : '',
    'If the task is complete, update the tracker. Otherwise continue.',
  ].filter(Boolean).join(' ');
}
```

模板引擎使用 **liquidjs**（Liquid 兼容，满足 Spec Section 5.4 的 strict 模式要求）。

### 3.5 Session ID 生成

Claude Code 没有 Codex 的 thread_id / turn_id。替代方案：

```
session_id = "<workspace_key>-<timestamp>"
// 例如: "MT-100-1709123456789"
```

session_id 在 worker attempt 开始时生成，整个 turn loop 内不变。
日志中的 session_id 关联到同一个 worker 生命周期。

### 3.6 Stall Detection 适配

Spec 的 stall detection 基于 `last_codex_timestamp`（驻留进程的事件间隔）。
Claude Code 每个 turn 是独立进程，不存在"进程在但无输出"的 stall 场景。

**适配策略**：stall detection 在 Claude Code 场景下退化为 `turn_timeout_ms`。
orchestrator 不需要对 Claude Code session 做 stall detection。
超时由 `Bun.spawn` + `turn_timeout_ms` 控制：如果进程在超时时间内没有退出，kill 它。

### 3.7 配置映射

WORKFLOW.md 中 Claude Code 特定配置：

```yaml
agent:
  max_concurrent_agents: 10
  max_turns: 20
  max_retry_backoff_ms: 300000

# Claude Code adapter 专属配置
claude_code:
  command: claude              # 默认 claude
  output_format: stream-json   # 固定
  timeout_ms: 3600000          # 单 turn 超时
  approval_policy: auto        # --dangerously-skip-permissions 等
```

## 4. 飞书多维表格 Tracker Adapter 设计

### 4.1 认证模型

```
┌──────────────────────────────────┐
│  app_id + app_secret             │
│        │                         │
│        ▼                         │
│  POST /open-apis/auth/v3/        │
│       tenant_access_token/internal│
│        │                         │
│        ▼                         │
│  tenant_access_token (2h TTL)    │
│        │                         │
│        ▼                         │
│  自动刷新（token 过期前重新获取）  │
└──────────────────────────────────┘
```

### 4.2 字段映射

WORKFLOW.md 中飞书多维表格的配置：

```yaml
tracker:
  kind: feishu_bitable
  app_id: $FEISHU_APP_ID
  app_secret: $FEISHU_APP_SECRET
  app_token: "bascnXXXXXX"         # 多维表格 app token
  table_id: "tblXXXXXX"            # 表 ID
  state_field: "状态"               # 单选字段名
  identifier_field: "编号"          # 标识字段名（用于 workspace 命名）
  title_field: "标题"
  description_field: "描述"
  priority_field: "优先级"          # 可选
  labels_field: "标签"              # 可选，多选字段
  active_states: ["待处理", "进行中"]
  terminal_states: ["已完成", "已取消"]
```

Issue 模型映射：

```
┌──────────────────────────────────────────────┐
│  飞书多维表格 record        → Issue           │
│                                              │
│  record_id                  → id             │
│  fields["编号"]              → identifier     │
│  fields["标题"]              → title          │
│  fields["描述"]              → description    │
│  fields["状态"]              → state          │
│  fields["优先级"]            → priority       │
│  fields["标签"]              → labels         │
│  (v1 忽略)                  → blocked_by []  │
│  created_time               → created_at     │
│  last_modified_time         → updated_at     │
└──────────────────────────────────────────────┘
```

**v1 决策：`blocked_by` 永远为空。** 飞书多维表格没有原生的 "blocks" 关系类型。
Spec Section 8.2 的 blocker 规则（Todo 状态 issue 有非终止态 blocker 则不调度）
在飞书场景下等同于无条件放行。如果未来需要支持 blocker 语义，
可以通过飞书多维表格的"关联"字段 + 自定义关联表实现。

### 4.3 状态归一化策略

飞书多维表格的 state 是单选字段，值可能是中文（如 `"待处理"`）。
`toLowerCase()` 对中文无效，因此采用 **精确匹配 + trim** 策略：

```typescript
// 状态比较：trim 后精确匹配（不做 lowercase）
function normalizeState(state: string): string {
  return state.trim();
}

function isActiveState(state: string, activeStates: string[]): boolean {
  return activeStates.some(s => normalizeState(s) === normalizeState(state));
}
```

WORKFLOW.md 中的 `active_states` / `terminal_states` 值必须和飞书单选字段值**完全一致**
（包括大小写、空格）。配置校验时会 warn 如果发现 tracker 返回的 state 值
不在 active_states ∪ terminal_states 中。

此策略也适用于 `max_concurrent_agents_by_state` 的 key 匹配。

### 4.4 API 调用

```typescript
// 核心查询：按状态过滤获取候选 issues
async fetchCandidateIssues(): Promise<Issue[]> {
  const filter = {
    conjunction: 'or',
    conditions: activeStates.map(state => ({
      field_name: this.config.stateField,
      operator: 'is',
      value: [state],
    })),
  };

  return this.listRecords(filter);
}

// list/search API with pagination
async listRecords(filter?: Filter): Promise<Issue[]> {
  const records = [];
  let pageToken: string | undefined;

  do {
    const resp = await fetch(
      `${BASE_URL}/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records`,
      {
        headers: { Authorization: `Bearer ${tenantAccessToken}` },
        params: { page_size: 50, page_token: pageToken, filter: JSON.stringify(filter) },
      }
    );
    records.push(...resp.data.items);
    pageToken = resp.data.page_token;
  } while (pageToken);

  return records.map(r => this.mapRecordToIssue(r));
}
```

## 5. Orchestrator 设计

### 5.1 主循环

```
┌──────────────────────────────────────────────────┐
│                   Orchestrator                    │
│                                                  │
│  ┌─────────┐    ┌──────────┐    ┌─────────────┐ │
│  │  tick    │───▶│reconcile │───▶│  dispatch   │ │
│  │ (poll)  │    │  running │    │  eligible   │ │
│  └─────────┘    └──────────┘    └─────────────┘ │
│       │                              │           │
│       │         ┌──────────┐         │           │
│       └─────────│schedule  │◀────────┘           │
│                 │next tick │                     │
│                 └──────────┘                     │
│                                                  │
│  State:                                          │
│  · running: Map<issueId, RunningEntry>           │
│  · claimed: Set<issueId>                         │
│  · retryAttempts: Map<issueId, RetryEntry>       │
│  · completed: Set<issueId>                       │
│  · codexTotals: { input, output, total, seconds} │
└──────────────────────────────────────────────────┘
```

### 5.2 状态机

```
                    poll tick
                       │
                       ▼
                 ┌──────────┐
          ┌─────│ Unclaimed │
          │     └──────────┘
          │            │ dispatch eligible
          │            ▼
          │     ┌──────────┐
          │     │  Running  │◀── continuation retry (1s)
          │     └─────┬────┘
          │           │
          │     ┌─────┴──────────────────┐
          │     │                        │
          │     ▼ normal exit            ▼ abnormal exit
          │  ┌──────────────┐   ┌──────────────┐
          │  │ continuation │   │    retry     │
          │  │ retry (1s)   │   │  (backoff)   │
          │  └──────────────┘   └──────────────┘
          │           │                 │
          │           ▼                 ▼
          │     re-check issue     re-check issue
          │           │                 │
          │     ┌─────┴──────┐   ┌─────┴──────┐
          │     │still active│   │still active│
          │     │→ re-dispatch   │→ re-dispatch
          │     │not active  │   │not active  │
          │     │→ Released  │   │→ Released  │
          │     └────────────┘   └────────────┘
          │
          │  reconcile: terminal/non-active
          │           │
          │           ▼
          │     ┌──────────┐
          └────▶│ Released │
                └──────────┘
```

### 5.3 Startup 流程

```
start_service()
  │
  ├── 1. configure_logging()
  ├── 2. start_workflow_watch(on_change = reload_and_reapply)
  ├── 3. validate_dispatch_config() → fail startup if invalid
  ├── 4. startup_terminal_workspace_cleanup()
  │     ├── tracker.fetchIssuesByStates(terminal_states)
  │     └── for each terminal issue → remove workspace dir
  ├── 5. schedule_tick(delay = 0)  // 立即首次 tick
  └── 6. event_loop(state)
```

Startup cleanup 失败不阻塞启动，只 log warning。

### 5.4 并发控制

```typescript
function availableSlots(state: OrchestratorState, config: ServiceConfig): number {
  const globalAvailable = Math.max(config.maxConcurrentAgents - state.running.size, 0);
  // per-state 限制在 dispatch 时逐个检查
  return globalAvailable;
}

function canDispatch(issue: Issue, state: OrchestratorState, config: ServiceConfig): boolean {
  // 全局并发
  if (state.running.size >= config.maxConcurrentAgents) return false;
  // 已 claim
  if (state.claimed.has(issue.id)) return false;
  // per-state 并发（使用 trim 精确匹配，见 4.3）
  const normalizedState = normalizeState(issue.state);
  const stateLimit = config.maxConcurrentAgentsByState.get(normalizedState);
  if (stateLimit !== undefined) {
    const runningInState = [...state.running.values()]
      .filter(r => normalizeState(r.issue.state) === normalizedState).length;
    if (runningInState >= stateLimit) return false;
  }
  // blocker 规则（v1 跳过：blocked_by 永远为空）
  // if (issue.state === '待处理') {
  //   if (issue.blockedBy.some(b => b.state && !isTerminal(b.state))) return false;
  // }
  return true;
}
```

### 5.5 Retry 策略

```
正常 worker 退出 (turn loop 结束):
  → continuation retry, 固定 delay = 1000ms, attempt = 1

异常 worker 退出 (error / timeout / stall / cancelled):
  → exponential backoff retry
  → delay = min(10000 * 2^(attempt - 1), agent.max_retry_backoff_ms)
  → attempt 递增
  → 默认 max_retry_backoff_ms = 300000 (5min)

Retry timer 触发后:
  → 重新 fetch candidate issues
  → 如果 issue 仍 active → re-dispatch
  → 如果 issue 不在 candidates 中 → release claim
  → 如果无 slot → requeue retry, error = "no available orchestrator slots"
```

### 5.6 Runtime 聚合

```typescript
// token 和 runtime 聚合
interface AggregateTotals {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  secondsRunning: number;  // 累计已结束 session 的 runtime
}

// snapshot 时动态计算（不后台 ticking）:
function effectiveSecondsRunning(state: OrchestratorState): number {
  const ended = state.aggregateTotals.secondsRunning;
  const active = [...state.running.values()]
    .reduce((sum, r) => sum + (Date.now() - r.startedAt) / 1000, 0);
  return ended + active;
}
```

## 6. Config 热加载

### 6.1 $VAR 解析规则

```typescript
// $VAR 解析：仅对包含 $ 前缀的值生效
function resolveEnvValue(value: string): string | undefined {
  if (!value.startsWith('$')) return value;
  const varName = value.slice(1);
  const resolved = process.env[varName];
  // 空字符串 = 缺失（Spec Section 5.3.1）
  if (resolved === '' || resolved === undefined) return undefined;
  return resolved;
}
```

`$VAR` 解析仅用于明确包含 `$VAR_NAME` 的配置值，不会全局覆盖 YAML 值。

### 6.2 模板引擎

使用 **liquidjs**（Liquid 模板语言实现），满足 Spec Section 5.4 要求：
- strict variable checking（未知变量报错）
- strict filter checking（未知 filter 报错）
- 支持 `{{ issue.title }}`, `{{ attempt }}` 等变量

### 6.3 热加载流程

```
┌────────────────┐     fs watch      ┌──────────────┐
│  WORKFLOW.md   │ ─────────────────▶│   watcher    │
└────────────────┘                   └──────┬───────┘
                                            │ on change
                                            ▼
                                     ┌──────────────┐
                                     │   loader     │
                                     │ parse + validate
                                     └──────┬───────┘
                                            │
                                   ┌────────┴────────┐
                                   │ valid?           │
                                   ▼                 ▼
                              ┌─────────┐      ┌──────────┐
                              │ apply   │      │ keep old │
                              │ new cfg │      │ log error│
                              └─────────┘      └──────────┘
                                   │
                                   ▼
                         ┌──────────────────┐
                         │ update effective │
                         │ · poll interval  │
                         │ · concurrency    │
                         │ · active/terminal│
                         │ · agent config   │
                         │ · prompt template│
                         │ · hooks          │
                         └──────────────────┘
```

Bun 使用 `Bun.fileWatcher()` 或 Node.js 兼容的 `fs.watch()` 实现文件监听。

## 7. Workspace 安全

遵循 Spec Section 9.5 的三个不变量：

```typescript
// 1. workspace key sanitize
function sanitizeKey(identifier: string): string {
  return identifier.replace(/[^A-Za-z0-9._-]/g, '_');
}

// 2. path containment
function validateContainment(workspacePath: string, root: string): boolean {
  const resolved = path.resolve(workspacePath);
  const resolvedRoot = path.resolve(root);
  return resolved.startsWith(resolvedRoot + path.sep) || resolved === resolvedRoot;
}

// 3. agent cwd = workspace path（launch 前断言）
function assertAgentCwd(workspacePath: string): void {
  if (process.cwd() !== workspacePath) {
    throw new Error(`Agent cwd must be workspace path`);
  }
}
```

## 8. 错误处理

类型化错误体系：

```typescript
class SymphonyError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

// Workflow 错误
class MissingWorkflowFileError extends SymphonyError {
  constructor() { super('missing_workflow_file', '...'); }
}
class WorkflowParseError extends SymphonyError {
  constructor() { super('workflow_parse_error', '...'); }
}

// Tracker 错误
class TrackerApiError extends SymphonyError {
  constructor(public statusCode: number, message: string) {
    super('tracker_api_error', message);
  }
}

// Agent 错误
class AgentSessionError extends SymphonyError {
  constructor(code: string, message: string) {
    super(code, message);
  }
}

// Workspace 错误
class WorkspaceSafetyError extends SymphonyError {
  constructor(message: string) {
    super('workspace_safety_error', message);
  }
}
```
