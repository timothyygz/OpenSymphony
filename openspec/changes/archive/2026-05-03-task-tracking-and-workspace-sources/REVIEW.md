# 方案审查：Task Tracking & Workspace Sources

> 审查日期：2026-05-03
> 审查范围：`openspec/changes/task-tracking-and-workspace-sources/` 下所有文档

---

## 一、方案概要

本方案包含三个相对独立但相互配合的能力：

| 模块 | 目标 |
|------|------|
| **Turn Log** | 将 agent 每轮对话完整记录到 workspace 的 `.symphony/turns.jsonl` |
| **Tracker Feedback** | 将会话命令、进度、结果摘要回写到飞书多维表格 |
| **Workspace Sources** | 支持从远端仓库 clone 或本地仓库 worktree 初始化 workspace |

方案文档结构清晰，proposal → design → specs → tasks 层次分明，决策记录完整（D1-D7），风险/权衡分析到位。整体质量不错。

---

## 二、架构层面问题

### 2.1 🔴 `createForIssue()` 同步/异步不兼容

**现状**：`WorkspaceManager.createForIssue()` 是同步方法（使用 `mkdirSync`、`existsSync`），返回 `Workspace` 对象。调用方 `runWorker()` 拿到返回值后立即使用。

**方案要求**：在 `mkdir` 之后、`after_create` hook 之前调用 `initSources()`。但 `initSources()` 需要执行 git 命令（spawn 子进程），是异步操作。

**问题**：
1. 要么将 `createForIssue()` 改为 `async`（breaking change，所有调用方需 await），要么将 sources 初始化拆到 `createForIssue()` 返回之后
2. 当前 `createForIssue()` 已经有一个隐患：`after_create` hook 是用 `.catch()` 触发的，没有 await，这意味着 hook 实际上和后续代码并发执行。Sources 初始化如果也这样处理，会导致 agent 在代码还没 clone 完时就启动了

**建议**：
- 将 `createForIssue()` 改为 `async createForIssue(): Promise<Workspace>`
- 在 orchestrator 的 `runWorker()` 中 `await` 整个流程：`mkdir → initSources → after_create hook`
- 这也顺便修复了当前 `after_create` hook 不被 await 的 bug

### 2.2 🔴 WorkspaceManager 无法获取 Sources 配置

**现状**：`WorkspaceManager` 构造函数只接收 `WorkspaceManagerConfig { root, hooks }`，不持有 workflow 配置。

**方案要求**：cleanup 时需要知道 sources 类型来决定用 `git worktree remove` 还是 `rm -rf`（Decision D5）。但 cleanup 发生在 `Orchestrator.reconcileTrackerStates()` 和 `onWorkerExit()` 中，此时需要将 sources 配置传递给 `WorkspaceManager`。

**问题**：
- Sources 配置定义在 `WORKFLOW.md` 中，由 `WorkflowLoader` 解析。`WorkspaceManager` 在构造时就确定了配置，但 workflow 可以热加载更新
- cleanup 时使用的应该是创建 workspace 时的 sources 配置，而非当前的 sources 配置

**建议**：
- **方案 A（推荐）**：在 `.symphony/meta.json` 中记录 workspace 创建时的 sources 配置。cleanup 时读取 meta.json 来决定清理策略。这样即使 workflow 配置变了，cleanup 仍能正确工作
- **方案 B**：将 sources 配置作为参数传入 `cleanupWorkspace()`，由 orchestrator 传递当前配置（不完美，但更简单）

### 2.3 🟡 Turn Log 与 Execution Log 职责重叠

**现状**：项目已有 `ExecutionLog`（`src/logging/execution-log.ts`），记录 dispatch、turn_completed、worker_exit 等事件到全局 JSONL 文件。

**方案新增**：`TurnLog`，记录每轮对话细节到 workspace 本地的 `.symphony/turns.jsonl`。

**问题**：
- 两者都是 JSONL 格式的事件日志，部分信息重叠（如 turn 计数、token 使用量）
- `ExecutionLog` 记录 orchestrator 层面的事件，`TurnLog` 记录 agent 层面的事件。但这个边界没有在方案中明确说明

**建议**：
- 在 design.md 中明确界定：`ExecutionLog` = orchestrator 生命周期事件（dispatch/exit/state transition）；`TurnLog` = agent 对话内容（prompt/response/tool）
- 考虑让 `TurnLog` 的 `meta.json` 引用 `ExecutionLog` 中对应 issue 的记录（通过 identifier 关联），方便交叉查询

### 2.4 🟡 Sources 初始化失败的回滚策略不完整

**方案说明**（spec workspace-sources）："Source failure stops initialization, workspace creation fails"。

**问题**：
- 如果有 3 个 sources，第 1 个 clone 成功，第 2 个失败，第 1 个已经 clone 到 workspace 了
- 方案只说"abort remaining"，没说是否清理已成功的 source
- 更复杂的是：如果 worktree 已添加但后续失败，需要 `git worktree remove` 清理

**建议**：
- 在 `initSources()` 中实现回滚：遍历已成功的 sources 执行逆操作（worktree → remove，clone → rm）
- 在 spec 中补充 "Source partial failure" 场景的行为定义

---

## 三、设计细节问题

### 3.1 🟡 AgentEvent.rawEvent 的类型安全

**方案**（Decision D7）：新增 `rawEvent: unknown`。

**问题**：
- `unknown` 在使用时需要大量类型断言，降低了代码可读性
- Claude Code 的 `stream-json` 输出格式有一定稳定性，可以定义基本结构

**建议**：
```typescript
// 定义已知的 Claude Code 事件结构
interface ClaudeStreamEvent {
  type: "assistant" | "tool_use" | "tool_result" | "result" | "system";
  message?: { content: unknown[]; usage?: TokenUsage };
  tool_name?: string;
  tool_input?: unknown;
  result?: string;
  [key: string]: unknown; // 允许未知字段透传
}

// AgentEvent 中
interface AgentEvent {
  // ...existing fields
  rawEvent?: ClaudeStreamEvent;
}
```
这样既保留了透传能力，又提供了类型提示。

### 3.2 🟡 Tracker 反馈使用可选接口方法

**方案**（spec tracker-feedback）：在 `TrackerAdapter` 接口新增三个可选方法 `updateIssueJoinCommand?`、`updateIssueProgress?`、`updateIssueResultSummary?`。

**问题**：
- 可选接口方法在调用方需要大量 `if (tracker.updateIssueJoinCommand)` 检查
- 新增 adapter 时容易遗漏实现
- 违反了接口隔离原则（ISP）——不是所有 tracker 都需要这些方法

**建议**：
- **方案 A**：定义独立的 `TrackerFeedbackAdapter` 接口，与 `TrackerAdapter` 分离。Orchestrator 中用类型守卫或鸭子类型判断是否支持
- **方案 B（更简单）**：在 `TrackerAdapter` 基类中提供 no-op 默认实现（如果用抽象类而非接口）：
  ```typescript
  // 让 FeishuBitableAdapter override 有意义的实现
  // 其他 adapter 自动 no-op
  updateIssueJoinCommand?(issueId: string, command: string): Promise<void> { return Promise.resolve(); }
  ```

### 3.3 🟡 进度摘要的质量

**方案**（spec tracker-feedback）：进度格式为 `Turn {n}/{maxTurns}: {lastAgentMessage 截断 200 字符}`。

**问题**：
- `lastAgentMessage` 可能是空的（某些 turn 可能只有 tool 调用没有文字消息）
- `lastAgentMessage` 可能是 tool 结果（如一大段文件内容），作为进度摘要没有意义
- 200 字符对于中文内容可能太少（一个 UTF-8 中文字符 = 3 bytes，但 200 字符已经足够语义表达）

**建议**：
- 增加摘要提取逻辑：优先取 `assistant` 类型的 text 消息，跳过纯 tool_result
- 对于没有 assistant 消息的 turn，使用 `"Turn {n}/{max}: Tool calls ({tool1}, {tool2}, ...)"` 格式
- 考虑让摘要提取策略可配置

### 3.4 🟡 Worktree 并发安全

**方案**（design.md Risks）："git worktree add 是读操作（创建新 worktree），不修改现有分支，并发安全。"

**这是不准确的**。`git worktree add` 会修改主仓库的 `.git/worktrees/` 目录和 `.git/worktree` 引用。多个任务并发对同一个主仓库执行 `git worktree add` 理论上可能导致竞争条件（虽然 git 内部有 lock 文件保护，但并发失败会抛出错误）。

**建议**：
- 在 risks 中更准确地描述：git 内部有 lock 机制，并发 worktree add 通常安全，但在极端并发下可能因 lock contention 导致临时失败
- 考虑对同一 repo 的 worktree 操作加一个轻量级的进程内 mutex（`Map<string, Promise>`）

### 3.5 🟢 Git Clone 缺少认证配置

**方案**：`git-clone` 类型只有 `url`、`path`、`branch`、`depth` 字段。

**问题**：
- 对于私有仓库，需要 SSH key 或 HTTPS token
- 不同仓库可能需要不同的认证方式

**建议**：
- v1 可以不处理，依赖宿主机的 git 全局配置（`~/.ssh/`、`~/.gitconfig`、credential helper）
- 在文档中说明：clone 使用宿主机默认的 git 认证配置
- 预留 `auth` 字段供后续扩展（如 `auth: { type: "ssh-key", key_path: "~/.ssh/deploy_key" }`）

### 3.6 🟢 depth: 0 的语义

**方案**（spec workspace-sources）：`depth: 0` 表示不使用 `--depth`。

**问题**：`depth` 默认为 1（shallow clone），设为 0 表示完整 clone。这个 0 = 无限制的语义不够直觉。

**建议**：
- 考虑使用 `depth: null` 或 `depth: false` 表示完整 clone，但 Zod schema 需要支持 `z.number().nullable()`
- 或者明确文档说明 `0 = full clone`，这在 git 生态中也有先例（如 `git fetch --depth=0` 某些场景下表示完整）

---

## 四、Spec 细节问题

### 4.1 🟡 缺少 Turn Log 的字符编码和换行处理

`turns.jsonl` 中每行是 JSON。但 agent 的 prompt 和 response 可能包含换行符 `\n`，如果 `JSON.stringify()` 处理不当，可能导致 JSONL 格式损坏。

**建议**：在 spec 中明确要求使用 `JSON.stringify()` 写入（会自动转义 `\n` 为 `\\n`），禁止手动拼接 JSON。

### 4.2 🟡 缺少 meta.json 的原子写入策略

`meta.json` 每个 turn 都会被更新（`totalTurns`、`totalTokens`）。如果进程在写入中途 crash，可能留下损坏的 JSON。

**建议**：
- 使用 write-then-rename 策略：先写 `.symphony/meta.json.tmp`，然后 `rename()` 覆盖
- 或使用 `JSON.stringify()` + `writeFileSync()` 覆盖写入（简单但不原子）

### 4.3 🟡 缺少 workspace 复用与 sources 变更的处理

**方案**：`createdNow = false` 时跳过 sources 初始化。但如果用户修改了 WORKFLOW.md 的 `workspace.sources` 配置，已存在的 workspace 不会更新。

**场景**：
1. 首次 dispatch：clone repo A → workspace 创建成功
2. 用户修改配置：改为 clone repo B
3. 任务失败重试：workspace 已存在，跳过 sources，agent 仍在 repo A 的代码上工作

**建议**：
- 在 `.symphony/meta.json` 中记录 sources 配置的 hash
- 复用时检查 hash 是否一致，不一致则发出 warning 或重建 workspace
- 或更简单：在 spec 中明确说明这是预期行为，sources 变更需要手动清理旧 workspace

### 4.4 🟢 Session ID 的 `--continue` vs `--session-id` 交互

**方案**（spec tracker-feedback）：后续 turn 使用 `--continue --session-id <id>`。

**问题**：需要确认 Claude Code CLI 是否支持同时传递 `--continue` 和 `--session-id`。如果 CLI 不支持，这个组合可能无效或报错。

**建议**：
- 在 tasks 中增加一个前置验证任务：确认 `claude --continue --session-id xxx` 的行为
- 准备备选方案：如果 CLI 不支持组合，可能只用 `--session-id` 来续接（Claude Code 的 session 机制可能自动续接同 ID 的会话）

---

## 五、Tasks 拆分建议

### 5.1 任务顺序优化

当前 tasks.md 的 10 个大任务中，存在隐含依赖关系。建议明确标注：

```
[Phase 1 - 基础设施]
  1.1-1.3 (Workspace Schema) → 无依赖
  4.1-4.3 (AgentEvent 扩展) → 无依赖

[Phase 2 - 核心]
  2.1-2.5 (Sources 初始化) → 依赖 1.1-1.3
  5.1-5.6 (Turn Log) → 依赖 4.1-4.3
  6.1-6.2 (Session ID) → 无依赖

[Phase 3 - 反馈]
  7.1-7.4 (Tracker 接口) → 无依赖
  8.1-8.5 (Bitable 实现) → 依赖 7.1-7.4

[Phase 4 - 集成]
  9.1-9.5 (Orchestrator 集成) → 依赖 2.1-2.5, 5.1-5.6, 6.1-6.2, 8.1-8.5
  3.1-3.4 (Worktree 清理) → 依赖 2.1-2.5

[Phase 5 - 文档与测试]
  10.1-10.4 → 依赖所有上述任务
```

### 5.2 缺少的任务项

- [ ] **Task 11**: 验证 Claude Code CLI `--session-id` + `--continue` 组合的行为（前置验证）
- [ ] **Task 12**: `createForIssue()` 从同步改为异步的重构，以及 `runWorker()` 中相应的调用方式调整
- [ ] **Task 13**: Sources 初始化失败的回滚逻辑（清理已成功的 source）
- [ ] **Task 14**: `.symphony/meta.json` 中存储 sources 配置快照，供 cleanup 时使用

---

## 六、整体评价

### 优点
1. **文档结构优秀**：proposal → design → specs → tasks 的分层非常清晰
2. **决策记录完整**：每个关键决策都有理由和备选方案（D1-D7）
3. **风险意识好**：识别了日志增长、API 频率、并发冲突等风险
4. **向后兼容**：所有新增都是 optional，不破坏现有功能
5. **Spec 场景驱动**：用 When/Then 格式的场景描述便于理解和验证

### 需要改进
1. **同步/异步转换**：这是最大的架构问题，必须先解决
2. **Sources 配置的生命周期管理**：从创建到 cleanup 的全链路需要想清楚
3. **部分失败处理**：多个 sources 中间失败的回滚策略需要补充
4. **任务依赖关系**：tasks.md 缺少显式的依赖标注和阶段划分

### 建议的实施顺序
1. 先做 **Task 12**（createForIssue 异步化重构），这是所有后续工作的基础
2. 先做 **AgentEvent 扩展**（Phase 1），Turn Log 和 Tracker Feedback 都依赖它
3. **Workspace Sources** 和 **Turn Log** 可以并行开发（互不依赖）
4. **Tracker Feedback** 的接口和实现可以在 Phase 3 独立进行
5. 最后做 **Orchestrator 集成**（Phase 4），串联所有模块
