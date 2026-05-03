# Symphony Service v1 - Tasks

## Phase 1: Foundation

- [x] **T1**: 初始化 Bun 项目（`bun init`，tsconfig strict，基础依赖：zod, pino, vitest）
- [x] **T2**: 实现 model 层（Issue, WorkflowDefinition, ServiceConfig, Workspace, RunAttempt, LiveSession, RetryEntry 类型定义 + Zod schema）
- [x] **T3**: 实现 errors 层（SymphonyError 基类 + 各子类）
- [x] **T4**: 实现 logging 层（pino 结构化日志，包含 issue_id / session_id 上下文）

## Phase 2: Workflow + Config

- [x] **T5**: 实现 Workflow Loader（WORKFLOW.md 解析：YAML front matter split + prompt body trim）
- [x] **T6**: 实现 Config Layer（Zod schema 校验 + 默认值 + `$VAR` 环境变量解析 + `~` 路径展开）
- [x] **T7**: 实现 Prompt Renderer（模板变量替换：issue + attempt，严格未知变量检查）
- [x] **T8**: 实现 Config Watcher（文件监听 + reload + 校验 + 无效时保持旧配置）

## Phase 3: Adapter Framework

- [x] **T9**: 定义 AgentAdapter interface + registry（src/adapters/agent/types.ts + registry.ts）
- [x] **T10**: 定义 TrackerAdapter interface + registry（src/adapters/tracker/types.ts + registry.ts）

## Phase 4: Feishu Bitable Tracker

- [x] **T11**: 实现飞书认证（app_id + app_secret → tenant_access_token，自动刷新）
- [x] **T12**: 实现飞书多维表格 API 封装（list records with filter, pagination, search）
- [x] **T13**: 实现 record → Issue mapper（字段映射，labels lowercase，priority int coerce）
- [x] **T14**: 实现 TrackerAdapter 接口（fetchCandidateIssues, fetchIssuesByStates, fetchIssueStatesByIds）
- [x] **T15**: 飞书 tracker 单元测试

## Phase 5: Claude Code Agent

- [x] **T16**: 实现 Claude Code 子进程管理（Bun.spawn，stdout stream-json 解析）
- [x] **T17**: 实现 AgentAdapter 接口（startSession, runTurn with --continue, stopSession）
- [x] **T18**: 实现 token usage / rate limit 解析（从 stream-json 输出提取）
- [x] **T19**: Claude Code adapter 单元测试（mock 子进程）

## Phase 6: Workspace Manager

- [x] **T20**: 实现 workspace 创建/复用（sanitize key, mkdir, created_now flag）
- [x] **T21**: 实现 workspace hooks（after_create, before_run, after_run, before_remove + timeout）
- [x] **T22**: 实现路径安全校验（root containment, key sanitize, cwd assertion）
- [x] **T23**: 实现 workspace 清理（terminal issue cleanup on startup + active transition）
- [x] **T24**: workspace manager 单元测试

## Phase 7: Orchestrator

- [x] **T25**: 实现 OrchestratorState 数据结构
- [x] **T26**: 实现 poll tick 主循环（reconcile → validate → fetch → sort → dispatch）
- [x] **T27**: 实现 dispatch 逻辑（slot 检查, claim, spawn worker, concurrency control）
- [x] **T28**: 实现 worker attempt 流程（workspace → hook → agent session → turn loop → hook → exit）
- [x] **T29**: 实现 reconcile（stall detection + tracker state refresh）
- [x] **T30**: 实现 retry 队列（指数退避 + continuation retry + slot 等待重入队）
- [x] **T31**: 实现 worker exit handler（normal → continuation retry, abnormal → backoff retry）
- [x] **T32**: 实现排序逻辑（priority asc → created_at asc → identifier lexicographic）

## Phase 8: CLI + Integration

- [x] **T33**: 实现 CLI 入口（参数解析，WORKFLOW.md 路径，启动/关闭）
- [x] **T34**: 实现 startup cleanup（terminal workspace sweep）
- [x] **T35**: 编写示例 WORKFLOW.md（飞书 + Claude Code 配置）
- [x] **T36**: 集成测试（完整 poll → dispatch → agent run → reconcile 流程）

## Phase 9: TODO (v1 不做)

- [ ] HTTP Dashboard + REST API（Section 13.7）
- [ ] Codex app-server adapter
- [ ] Linear tracker adapter
- [ ] OpenCode / Pi agent adapter
- [ ] `linear_graphql` client-side tool
- [ ] SSH Worker Extension
- [ ] 持久化 retry queue / session metadata
