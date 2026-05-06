## 1. CLI 子命令路由

- [x] 1.1 创建 `src/commands/` 目录，实现子命令注册和路由机制
- [x] 1.2 改造 `src/cli.ts` 的 `parseArgs`，检测子命令（init/doctor）并分发到对应 handler
- [x] 1.3 更新帮助文本，列出所有子命令和选项
- [x] 1.4 验证 `symphony [path]` 和 `symphony --no-tui [path]` 保持原行为不变

## 2. 飞书建表 API

- [x] 2.1 创建 `src/adapters/tracker/feishu-bitable/setup-api.ts`，封装 `FeishuBitableSetupApi` 类（复用 `FeishuAuth`）
- [x] 2.2 实现 `testConnection()` — 调用 auth API 验证凭据有效性
- [x] 2.3 实现 `createApp(name)` — `POST /open-apis/bitable/v1/apps`，返回 app_token + 默认 table_id + url
- [x] 2.4 实现 `createTable(appToken, fields)` — `POST /open-apis/bitable/v1/apps/{app_token}/tables`，含 10 个标准字段定义（注意：进度字段用 type:2 + ui_type:"Progress"，不是 type:22）
- [x] 2.5 实现 `deleteTable(appToken, tableId)` — `DELETE /open-apis/bitable/v1/apps/{app_token}/tables/{table_id}`
- [x] 2.6 为 setup-api 编写单元测试

## 3. Init 向导核心

- [x] 3.1 安装 `@clack/prompts` 依赖
- [x] 3.2 创建 `src/commands/init.ts`，实现向导主循环框架（步骤序列 + 取消处理）
- [x] 3.3 实现启动时检查：目标路径已有 WORKFLOW.md 时，提示覆盖或取消
- [x] 3.4 实现 Step 1: Tracker — 选择 feishu_bitable，输入 app_id/app_secret，连接测试（spinner），自动建表，状态名配置
- [x] 3.5 实现 Step 2: Agent — 自动选择 claude-code（不暴露 echo），CLI 可用性检查，参数收集
- [x] 3.6 实现 Step 3: Workspace — source type 选择（git-worktree/git-clone/none），路径输入（单个 source）
- [x] 3.7 实现 Step 4: Prompt template — 3 个预设模板选择 + 预览（Liquid 语法）
- [x] 3.8 实现 Step 5: Credential storage — inline / settings.json / env var 三选一
- [x] 3.9 实现 Step 6: Preview + confirm — 显示完整 WORKFLOW.md 内容，确认后写入文件。用户拒绝时提示重新运行 init
- [x] 3.10 创建 prompt 模板预设文件 `src/commands/templates/`（basic.md, chinese.md, empty.md），使用 Liquid 语法
- [x] 3.11 实现 WORKFLOW.md 文件生成（YAML front matter + Liquid 模板）

## 4. Doctor 诊断命令

- [x] 4.1 创建 `src/commands/doctor.ts`
- [x] 4.2 实现 Claude CLI 可用性检查
- [x] 4.3 实现 WORKFLOW.md 解析和 validateDispatchConfig 校验
- [x] 4.4 实现飞书凭据连接测试（复用 setup-api 的 testConnection）
- [x] 4.5 实现多维表格访问测试（listRecords 调用）
- [x] 4.6 实现 workspace 目录可写性检查
- [x] 4.7 实现 Git 可用性检查（workspace source 需要时）
- [x] 4.8 实现汇总输出（pass/fail 列表）和非零退出码

## 5. 集成与验证

- [x] 5.1 端到端测试：`symphony init` 生成 WORKFLOW.md 后，启动 symphony 验证配置有效
- [x] 5.2 端到端测试：`symphony doctor` 对有效配置输出全部 PASS
- [x] 5.3 更新 README.md 添加 `symphony init` 和 `symphony doctor` 使用说明
