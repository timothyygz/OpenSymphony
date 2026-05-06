## Context

OpenSymphony 当前需要用户手动复制 `WORKFLOW.md.example` 并填写 10+ 个飞书多维表格字段映射、凭据、工作空间配置等。这对新用户有较高的上手门槛。

现有代码架构：
- `src/cli.ts` — 单一入口，只有 `--no-tui` 和 `--help` 两个选项
- `src/adapters/tracker/registry.ts` — 注册式 Tracker 工厂，当前只有 `feishu-bitable`
- `src/adapters/agent/registry.ts` — 注册式 Agent 工厂，有 `claude-code` 和 `echo`
- `src/workflow/config.ts` — 支持 `~/.open-symphony/settings.json` 全局默认值、`$VAR` 环境变量引用
- `src/adapters/tracker/feishu-bitable/auth.ts` — 飞书认证（tenant_access_token）
- `src/adapters/tracker/feishu-bitable/api.ts` — Bitable 记录 CRUD，无表级操作

## Goals / Non-Goals

**Goals:**
- `symphony init` 交互式引导用户生成 WORKFLOW.md，2 分钟内完成
- 飞书 Bitable 自动建表：用户只提供 app_id + app_secret，向导自动创建合规表格
- 连接测试：验证飞书凭据和 Claude CLI 可用性后再写配置
- `symphony doctor` 系统诊断命令
- CLI 子命令路由（init / doctor / start）

**Non-Goals:**
- Linear tracker 支持（未来扩展）
- 多配置文件管理（WORKFLOW.dev.md 等）
- 非交互式 `--quick` 模式
- Web UI

## Decisions

### D1: CLI 子命令路由

将 `src/cli.ts` 改造为子命令路由器：

```
symphony init [path]       → 交互式引导
symphony doctor [path]     → 系统诊断
symphony [path]            → 启动服务（原行为）
symphony --help            → 帮助
```

**实现**：在 `src/cli.ts` 的 `parseArgs` 中检测第一个位置参数是否为子命令。子命令逻辑放在 `src/commands/` 目录下。

**为什么不用 Commander.js / CAC**：当前只有 3 个子命令，手动路由足够。避免引入新依赖。

### D2: 交互库选择 — @clack/prompts

使用 `@clack/prompts`（clack），原因：
- 专为 CLI 设计，spinner/progress/select/text 全套
- 零重依赖，体积小
- 比 Inquirer 更现代的 API

**备选方案**：Inquirer（更成熟但更重）、prompts（terenceweston，功能较少）

### D3: 飞书自动建表流程

用户只提供 `app_id` + `app_secret`，向导执行 4 步：

```
1. 认证测试 → POST /open-apis/auth/v3/tenant_access_token/internal
2. 创建多维表格 → POST /open-apis/bitable/v1/apps
3. 创建含标准字段的表 → POST /open-apis/bitable/v1/apps/{app_token}/tables
4. 删除默认空表 → DELETE /open-apis/bitable/v1/apps/{app_token}/tables/{default_table_id}
```

**标准字段定义**（10 个）：

| 字段名 | 字段类型 | type 值 | 说明 |
|--------|---------|---------|------|
| 编号 | AutoNumber | 1005 | 自动编号，不可做索引列 |
| 标题 | Text | 1 | 索引列 |
| 状态 | SingleSelect | 3 | 选项：待处理、进行中、已完成、已取消、已关闭 |
| 描述 | Text | 1 | 多行文本 |
| 优先级 | SingleSelect | 3 | 选项：P0、P1、P2、P3 |
| 标签 | MultiSelect | 4 | 无预设选项 |
| tokens消耗 | Number | 2 | 整数 |
| 进度 | Number (ui_type: Progress) | 2 + ui_type:"Progress" | 百分比进度条，是 Number 类型的显示变体 |
| 结果摘要 | Text | 1 | 多行文本 |
| 操作命令 | Text | 1 | 单行文本 |

**注意**：
- 创建表时索引列（第一个 field，`is_primary: true`）只支持类型：1,2,5,13,15,20,22。不支持 AutoNumber(1005)。因此标题(Text) 作为索引列。
- type 22 是 Location（地理位置），不是 Progress。进度字段实际上是 `type: 2`（Number）+ `ui_type: "Progress"` 的组合。

### D4: 新增 FeishuBitableSetupApi

在 `src/adapters/tracker/feishu-bitable/` 下新增 `setup-api.ts`，封装建表相关的 API 调用。复用现有的 `FeishuAuth` 类做认证。

不扩展现有 `FeishuBitableApi`，因为该类需要 `appToken + tableId` 构造，而向导阶段这些值还不存在。

### D5: 凭据存储策略

向导在最后一步让用户选择凭据存储方式：
1. **内联写入 WORKFLOW.md** — 简单直接
2. **存入 `~/.open-symphony/settings.json`** — 多配置文件共享
3. **环境变量** — WORKFLOW.md 中写 `$FEISHU_APP_ID`，用户自行设置环境

### D6: Prompt 模板预设

向导提供 3 个预设模板供选择（均使用 Liquid 语法，与 `liquidjs` 引擎一致）：
1. **基础模板** — 简单的任务描述 + 指令
2. **中文模板** — 含中文指引（当前 WORKFLOW.md 的风格）
3. **空模板** — 仅框架，用户自行填写

### D7: symphony doctor 检查项

```
1. Claude CLI 可用性 (which claude)
2. WORKFLOW.md 存在性和解析
3. 配置验证 (validateDispatchConfig)
4. 飞书凭据连接测试 (tenant_access_token)
5. 多维表格访问测试 (listRecords)
6. 工作空间目录可写性
7. Git 可用性 (workspace source 需要)
```

## Risks / Trade-offs

**[飞书 API 权限不足]** → 建表需要 `bitable:app` 和 `bitable:app:readonly` 权限。向导在连接测试步骤捕获权限错误，给出明确提示（缺少哪些 scope）。

**[clack 对 Bun 的兼容性]** → `@clack/prompts` 基于 Node.js readline，Bun 对此有良好支持，但仍需测试。降级方案：用 `Bun.$.prompt()` 或直接 `readline`。

**[默认空表删除失败]** → 创建 Bitable App 时飞书会自动创建一个空表。如果删除失败（权限不足），不影响功能但会有多余空表。向导应提示用户手动删除。

**[向后兼容]** → CLI 改造后，`symphony /path/to/WORKFLOW.md` 必须保持原行为。子命令检测只在第一个参数为已知子命令时触发。

**[已有配置文件]** → 如果目标路径已有 WORKFLOW.md，向导在开始前提示用户：覆盖（继续 init）或取消。

## Open Questions

- 是否需要支持 `symphony init --tracker feishu_bitable` 跳过 tracker 选择？目前设计中 init 是全交互式。
- doctor 输出格式：纯文本还是也支持 JSON 输出（`--json`）用于 CI 集成？

## Appendix: 模板引擎确认

经代码验证，项目使用 `liquidjs@^10.25.7`（Liquid 模板引擎）渲染 WORKFLOW.md 的 prompt 模板部分。渲染逻辑在 `src/workflow/prompt.ts`，通过 `engine.parseAndRenderSync(template, { issue, attempt })` 调用。模板上下文变量为 `issue`（包含 id, identifier, title, description 等）和 `attempt`（重试次数）。
