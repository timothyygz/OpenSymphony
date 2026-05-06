# OpenSpec 架构研究报告

> 基于对 OpenSymphony 项目中 OpenSpec 工作流系统的源码级分析。

## 1. 概述

OpenSpec 是一个 AI 原生的规格驱动开发系统，核心思路是：**用 CLI 编排工作流状态，用 AI 填充制品内容，用文件系统作为唯一的状态存储。**

它提供了四个阶段的 skill/commmand，覆盖从探索到归档的完整生命周期：

```
Explore（思考） → Propose（提议） → Apply（实现） → Archive（归档）
```

## 2. 技能与命令体系

### 2.1 注册方式

OpenSpec 有两套并行的调用入口，功能等价：

| 入口 | 路径 | 示例 | 标签 |
|------|------|------|------|
| **Skill** | `.claude/skills/openspec-<name>/SKILL.md` | `openspec-explore` | 稳定版 |
| **Command** | `.claude/commands/opsx/<name>.md` | `/opsx:explore` | 实验版 |

两者内容基本一致，Command 版本标记为 `experimental`。

### 2.2 四个核心 Skill

#### Explore — 思考模式

- **定位**：纯对话的思考伙伴，无固定步骤，无必需输出
- **核心约束**：NEVER 写代码，只读文件、搜索、讨论
- **唯一 CLI 调用**：`openspec list --json` 检查活跃变更
- **特点**：这是一个 "stance（姿态）" 而非 "workflow"，强调好奇、开放、可视化

#### Propose — 生成制品

- **定位**：一次性创建变更的所有制品文件
- **流程**：
  1. 派生 kebab-case 名称（或 AskUserQuestion）
  2. `openspec new change "<name>"` 创建目录
  3. `openspec status --json` 获取制品依赖图
  4. 按依赖顺序逐个调用 `openspec instructions <id> --json`
  5. 读取依赖制品内容 → 按 template 填充 → 写入文件
  6. 每写完一个重新查 status，直到 `applyRequires` 全部 `done`
- **使用的工具**：AskUserQuestion、TodoWrite

#### Apply — 实现任务

- **定位**：按 tasks.md 中的 checkbox 逐个实现代码
- **流程**：
  1. `openspec instructions apply --json` 获取上下文文件和任务列表
  2. 读取所有 contextFiles（proposal, specs, design, tasks）
  3. 逐任务实现，完成后 `- [ ]` → `- [x]`
  4. 遇阻暂停，全部完成建议归档
- **状态判断**：`blocked`（缺制品） / `ready` / `all_done`

#### Archive — 归档变更

- **定位**：将完成的变更移入归档目录，可选同步 delta spec
- **流程**：
  1. 检查制品和任务完成度，警告未完成项
  2. 对比 delta spec 与主 spec，提示同步
  3. **唯一使用 subagent 的场景**：通过 `Agent(subagent_type: "general-purpose")` 调用 `openspec-sync-specs`
  4. `mv openspec/changes/<name> openspec/changes/archive/YYYY-MM-DD-<name>`

### 2.3 工具使用矩阵

| Skill | AskUserQuestion | TodoWrite | Agent (subagent) | MCP Tool |
|-------|:-:|:-:|:-:|:-:|
| Explore | - | - | - | - |
| Propose | Yes | Yes | - | - |
| Apply | Yes | - | - | - |
| Archive | Yes | - | **Yes** | - |

## 3. 架构设计

### 3.1 三层架构

```
┌─────────────────────────────────────────────────┐
│              Claude Code Skill 层                │
│  （理解意图、组装指令、填充模板、写代码）          │
└──────────────────────┬──────────────────────────┘
                       │ Bash 调用
                       ▼
┌─────────────────────────────────────────────────┐
│              openspec CLI 层                      │
│  （状态计算、依赖图构建、指令组装）               │
└──────────────────────┬──────────────────────────┘
                       │ 读写
                       ▼
┌─────────────────────────────────────────────────┐
│              文件系统层                            │
│  schema.yaml / config.yaml / 制品文件 / 源码     │
└─────────────────────────────────────────────────┘
```

### 3.2 Schema 解析优先级

Schema 定义了制品的种类、依赖关系和生成指令。解析时按以下优先级查找：

```
1. 项目本地：openspec/schemas/<name>/schema.yaml
2. 用户覆盖：${XDG_DATA_HOME}/openspec/schemas/<name>/schema.yaml
3. 包内置：  @fission-ai/openspec/schemas/<name>/schema.yaml
```

### 3.3 spec-driven Schema 的制品依赖图

```
proposal ──────────┬──────────────→ specs ──┐
     │             │                         │
     │             └──────────────→ design ──┤
     │                                       │
     └───────────────────────────────────────┘→ tasks
```

`apply` 阶段配置：`requires: [tasks]`，`tracks: tasks.md`

## 4. CLI 指令详解

### 4.1 核心命令

| 命令 | 用途 | 返回内容 |
|------|------|----------|
| `openspec list --json` | 列出活跃变更 | 变更名、schema、状态 |
| `openspec new change "<name>"` | 创建变更目录 | 目录 + `.openspec.yaml` |
| `openspec status --change "<name>" --json` | 制品完成状态 | 每个制品的 done/ready/blocked |
| `openspec instructions <artifact> --json` | 制品生成指令 | 六元组（见下） |
| `openspec instructions apply --json` | 实现指令 | contextFiles + tasks + progress + state |

### 4.2 instructions 返回的六元组

`openspec instructions <artifact> --json` 返回：

```jsonc
{
  "changeName": "setup-wizard",
  "artifactId": "proposal",
  "schemaName": "spec-driven",
  "changeDir": "/path/to/openspec/changes/setup-wizard",
  "outputPath": "proposal.md",
  "description": "Initial proposal document outlining the change",
  "instruction": "Create the proposal document that...",   // 来自 schema.yaml
  "template": "## Why\n\n<!-- ... -->...",                  // 来自 templates/ 文件
  "context": "Tech stack: TypeScript...",                   // 来自 config.yaml
  "rules": ["Keep proposals under 500 words"],             // 来自 config.yaml
  "dependencies": [{ "id": "proposal", "done": true }],    // 来自 schema + 文件检查
  "unlocks": ["design", "specs"]                           // 反向依赖计算
}
```

来源对照：

| 字段 | 来源 | 说明 |
|------|------|------|
| `instruction` | `schema.yaml` → `artifacts[].instruction` | 告诉 AI 怎么写 |
| `template` | `templates/<file>` 文件内容 | 填空模板 |
| `context` | `openspec/config.yaml` → `context` | 项目背景 |
| `rules` | `openspec/config.yaml` → `rules.<id>` | 制品级约束 |
| `dependencies` | `schema.yaml` → `requires` + 文件存在检查 | 前置制品状态 |
| `unlocks` | 反向查找 `requires` | 完成后解锁哪些制品 |

### 4.3 instructions apply 的特殊返回

```jsonc
{
  "contextFiles": {
    "proposal": "/full/path/proposal.md",
    "specs": "/full/path/specs/**/*.md",
    "design": "/full/path/design.md",
    "tasks": "/full/path/tasks.md"
  },
  "progress": { "total": 32, "complete": 0, "remaining": 32 },
  "tasks": [
    { "id": "1", "description": "1.1 创建目录结构", "done": false },
    // ...
  ],
  "state": "ready",  // blocked | ready | all_done
  "instruction": "Read context files, work through pending tasks..."
}
```

## 5. 状态管理机制

### 5.1 核心原则：CLI 无状态，文件系统即状态

OpenSpec 的 CLI **不缓存、不持久化任何运行时状态**。每次调用都从头计算：

```
状态 = f(schema定义, 文件系统快照)
```

### 5.2 完成度检测

`detectCompleted()` 的判断逻辑极为简单——**纯文件存在性检查**：

```js
// 简化后的逻辑
for (const artifact of graph.getAllArtifacts()) {
  if (fs.existsSync(path.join(changeDir, artifact.generates))) {
    completed.add(artifact.id);  // 文件在 = done
  }
}
```

对 glob 模式（如 `specs/**/*.md`），使用 `fast-glob` 检查是否有匹配文件。

**没有内容校验、没有 hash 比对、没有版本追踪。**

### 5.3 任务进度解析

Apply 阶段的进度跟踪通过解析 `tasks.md` 中的 Markdown checkbox 实现：

```js
// 匹配 - [ ] 或 - [x] 或 - [X]
const checkboxMatch = line.match(/^[-*]\s*\[([ xX])\]\s*(.+)\s*$/);
```

AI 完成一个任务后，将 `- [ ]` 改为 `- [x]`，CLI 下次调用时重新解析即可得到最新进度。

### 5.4 写入者

| 时间点 | 写入者 | 写入内容 |
|--------|--------|----------|
| `openspec new change` | CLI | `.openspec.yaml`（schema 名 + 日期） |
| Propose 阶段 | AI (Claude) | proposal.md, design.md, specs/, tasks.md |
| Apply 阶段 | AI (Claude) | checkbox 标记 + 项目源码 |

**CLI 永远不写制品内容。** 它只写元数据（`.openspec.yaml`）和目录结构。

## 6. 上下文管理策略

### 6.1 设计层面：状态外置

OpenSpec 通过 CLI + 文件系统将状态外置，使对话上下文保持轻量：

- 每个 skill 在关键节点重新调用 `openspec status --json` 重建状态
- 制品内容存在文件中，需要时才读取，不常驻上下文
- `openspec instructions apply` 按需返回 contextFiles 列表，AI 按需 Read

```
┌──────────────────────┐     ┌──────────────────────┐
│    对话上下文 (轻量)    │     │   文件系统 + CLI      │
│                      │     │                      │
│  只做当前这一步       │────→│  openspec status      │
│  需要上下文时查询 CLI  │←────│  openspec/changes/    │
│  不累积历史状态       │     │  proposal.md ...      │
└──────────────────────┘     └──────────────────────┘
```

### 6.2 运行层面：Claude Code 自动压缩

当状态外置不够用时，Claude Code 的自动消息压缩机制作为安全网，在接近上下文限制时自动压缩历史消息。

### 6.3 未使用的手段

- 没有用 subagent 隔离上下文（除了 archive 的 spec 同步）
- 没有显式压缩指令或 "forget X" 提示
- 没有引用 `strategic-compact` skill
- 没有分段执行设计（apply 通过 checkbox 实现可中断/可恢复，但不是显式的上下文分段）

## 7. 文件结构

### 7.1 项目中的 OpenSpec 目录结构

```
openspec/
├── config.yaml                    # 项目配置：schema + context + rules
├── specs/                         # 主规格（canonical specs）
│   └── <capability>/spec.md
└── changes/
    ├── <name>/                    # 活跃变更
    │   ├── .openspec.yaml         # 变更元数据（schema 名、创建日期）
    │   ├── proposal.md            # 什么 & 为什么
    │   ├── design.md              # 怎么做
    │   ├── specs/                 # 增量规格（delta specs）
    │   │   └── <capability>/spec.md
    │   └── tasks.md               # 实现步骤（checkbox）
    └── archive/
        └── YYYY-MM-DD-<name>/     # 已归档变更
```

### 7.2 包内置的 Schema 结构

```
@fission-ai/openspec/schemas/spec-driven/
├── schema.yaml                    # 制品定义 + 依赖 + 指令
└── templates/
    ├── proposal.md                # 提案模板
    ├── spec.md                    # 规格模板
    ├── design.md                  # 设计模板
    └── tasks.md                   # 任务模板
```

### 7.3 Schema 解析优先级

```
1. openspec/schemas/<name>/schema.yaml    # 项目级（可覆盖）
2. ${XDG_DATA_HOME}/openspec/schemas/<name>/  # 用户级
3. 包内置 schemas/                         # 默认
```

## 8. 关键设计洞察

### 8.1 幂等性

由于状态完全由文件系统快照 + schema 定义推导，任何操作都是天然幂等的。无论对话上下文怎么被压缩或丢失，只要文件在磁盘上，CLI 就能准确重建完整状态。

### 8.2 Schema 驱动的灵活性

Skill 代码中不硬编码制品名称或文件路径。所有这些都由 `schema.yaml` 定义：

```yaml
# 换一个 schema 就能换一套完全不同的工作流
artifacts:
  - id: brief
    generates: brief.md
    template: brief.md
    requires: []
  - id: plan
    generates: plan.md
    template: plan.md
    requires: [brief]
```

Skill 通过 `openspec status --json` 和 `openspec instructions <id> --json` 动态获取当前 schema 的制品配置，无需修改。

### 8.3 CLI 作为中间层

CLI 承担了三个关键角色：

1. **状态计算器**：从文件系统推导制品完成度和依赖图
2. **指令组装器**：将 schema + config + template 组装为 AI 可执行的指令
3. **进度解析器**：从 tasks.md 的 checkbox 解析任务进度

AI 不需要理解 schema 格式或依赖图算法——CLI 把这些复杂性封装为 JSON 输出。

### 8.4 context/rules 的约束设计

`config.yaml` 中的 `context` 和 `rules` 在 `openspec instructions` 返回时作为独立字段，而非混入 template。Skill 中明确指示：

> "context 和 rules 是对 AI 的约束，不写入输出文件"

这种设计将**指导信息**和**输出结构**分离，避免 AI 把规则原封不动抄进制品。

## 9. 权限配置

`.claude/settings.local.json` 中预授权了所有 OpenSpec CLI 命令，避免交互时权限弹窗：

```json
{
  "permissions": {
    "allow": [
      "Bash(openspec list *)",
      "Bash(openspec create *)",
      "Bash(openspec --help)",
      "Bash(openspec change *)",
      "Bash(openspec instructions *)"
    ]
  }
}
```
