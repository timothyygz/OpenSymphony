import { registerTracker } from "../registry.ts";
import type { TrackerSetupFn } from "../../setup/types.ts";
import { createFeishuBitableAdapter } from "./adapter.ts";
import { FeishuAuth } from "./auth.ts";
import { FeishuBitableSetupApi, STANDARD_FIELDS } from "./setup-api.ts";

const REQUIRED_FIELD_NAMES = STANDARD_FIELDS.map((f) => f.field_name);

const STANDARD_FIELD_CONFIG = {
  state_field: "状态",
  identifier_field: "编号",
  title_field: "标题",
  description_field: "描述",
  priority_field: "优先级",
  labels_field: "标签",
  tokens_field: "tokens消耗",
  progress_field: "进度",
  result_summary_field: "结果摘要",
  join_command_field: "操作命令",
};

export const feishuBitableSetup: TrackerSetupFn = async (ctx) => {
  const p = ctx.prompts;

  p.note(
    "需要飞书自建应用的凭据来完成配置。\n\n" +
      "如果你还没有飞书应用，请前往飞书开放平台创建：\n" +
      "  https://open.feishu.cn/app\n\n" +
      "不知道怎么获取？可以问飞书「开放助手」：\n" +
      "  https://open.feishu.cn/app/ai/playground?from=nav&lang=zh-CN\n\n" +
      "凭据在应用的「凭证与基础信息」页面中。",
    "📋 飞书应用配置",
  );

  const section = await p.group({
    appId: () =>
      p.text({
        message: "飞书 App ID（在应用「凭证与基础信息」页面获取）",
        placeholder: "cli_xxxxxxxx",
      }),
    appSecret: () =>
      p.text({
        message: "飞书 App Secret（同页面，点击「显示」复制）",
        placeholder: "xxxxxxxxxxxxxxxx",
      }),
  });

  if (p.isCancel(section)) return { config: {} };

  const appId = section.appId as string;
  const appSecret = section.appSecret as string;

  // Use injected setup API if available (for testing), otherwise create real one
  const createSetupApi = ctx.testOverrides?.createSetupApi as
    | ((appId: string, appSecret: string) => any)
    | undefined;
  const setupApi = createSetupApi
    ? createSetupApi(appId, appSecret)
    : new FeishuBitableSetupApi(new FeishuAuth(appId, appSecret));

  // Test connection
  const s = p.spinner();
  s.start("Testing Feishu connection...");
  try {
    await setupApi.testConnection();
    s.stop("Connection successful");
  } catch (err) {
    s.stop("Connection failed");
    p.log.error(
      `Connection error: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { config: {} };
  }

  // Choose: create new or use existing
  const mode = await p.select({
    message: "选择多维表格方式",
    options: [
      { value: "new", label: "创建新的多维表格" },
      { value: "existing", label: "使用已有的多维表格" },
    ],
  });
  if (p.isCancel(mode)) return { config: {} };

  let appToken: string;
  let tableId: string;

  if (mode === "existing") {
    const urlInput = await p.text({
      message: "请输入飞书多维表格链接",
      placeholder: "https://xxx.feishu.cn/base/xxxxxx",
    });
    if (p.isCancel(urlInput)) return { config: {} };

    let u: URL;
    try {
      u = new URL(urlInput as string);
    } catch {
      p.log.error("无法解析多维表格链接，请确认链接格式正确");
      return { config: {} };
    }
    const match = u.pathname.match(/\/base\/([A-Za-z0-9]+)/);
    if (!match) {
      p.log.error("无法解析多维表格链接，请确认链接格式正确");
      return { config: {} };
    }
    appToken = match[1]!;
    const parsedTableId = u.searchParams.get("table") ?? undefined;

    // Validate access by listing tables
    s.start("正在获取多维表格信息...");
    let tables: { table_id: string; name: string }[];
    try {
      tables = await setupApi.listTables(appToken);
      s.stop(`获取成功，共 ${tables.length} 个工作表`);
    } catch (err) {
      s.stop("获取失败");
      p.log.error(
        `无法访问多维表格: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { config: {} };
    }

    // If URL has table_id, try to use it directly
    if (parsedTableId) {
      const target = tables.find((t) => t.table_id === parsedTableId);
      if (target) {
        s.start("正在检查工作表字段...");
        try {
          const fields = await setupApi.listFields(appToken, parsedTableId);
          s.stop("检查完成");
          const fieldNames = new Set(fields.map((f) => f.field_name));
          const missing = REQUIRED_FIELD_NAMES.filter((n) => !fieldNames.has(n));

          if (missing.length === 0) {
            p.log.success(`工作表「${target.name}」字段校验通过`);
            tableId = parsedTableId;
            return {
              config: { kind: "feishu_bitable", app_token: appToken, table_id: tableId, ...STANDARD_FIELD_CONFIG },
              credentials: { app_id: appId, app_secret: appSecret },
            };
          }
          p.log.warn(`工作表缺少字段: ${missing.join(", ")}`);
        } catch {
          s.stop("字段检查失败");
        }
      }
    }

    // Let user select a table or create a new one
    const tableOptions = [
      ...tables.map((t) => ({ value: t.table_id, label: t.name })),
      { value: "__create__", label: "创建新工作表（任务）" },
    ];

    const selectedTable = await p.select({
      message: "选择工作表",
      options: tableOptions,
    });
    if (p.isCancel(selectedTable)) return { config: {} };

    if (selectedTable === "__create__") {
      s.start("正在创建工作表...");
      try {
        const table = await setupApi.createTable(appToken, "任务");
        tableId = table.table_id;
        s.stop("工作表创建成功");
      } catch (err) {
        s.stop("创建失败");
        p.log.error(`${err instanceof Error ? err.message : String(err)}`);
        return { config: {} };
      }
    } else {
      tableId = selectedTable as string;
      const target = tables.find((t) => t.table_id === tableId);

      s.start("正在检查工作表字段...");
      try {
        const fields = await setupApi.listFields(appToken, tableId);
        s.stop("检查完成");
        const fieldNames = new Set(fields.map((f) => f.field_name));
        const missing = REQUIRED_FIELD_NAMES.filter((n) => !fieldNames.has(n));

        if (missing.length > 0) {
          p.log.warn(`工作表「${target?.name}」缺少字段: ${missing.join(", ")}`);

          const proceed = await p.confirm({
            message: "字段不完整，是否在此多维表格中创建新工作表？",
          });
          if (p.isCancel(proceed) || !proceed) return { config: {} };

          s.start("正在创建工作表...");
          try {
            const table = await setupApi.createTable(appToken, "任务");
            tableId = table.table_id;
            s.stop("工作表创建成功");
          } catch (err) {
            s.stop("创建失败");
            p.log.error(`${err instanceof Error ? err.message : String(err)}`);
            return { config: {} };
          }
        } else {
          p.log.success(`工作表「${target?.name}」字段校验通过`);
        }
      } catch (err) {
        s.stop("字段检查失败");
        p.log.error(`${err instanceof Error ? err.message : String(err)}`);
        return { config: {} };
      }
    }

    return {
      config: { kind: "feishu_bitable", app_token: appToken, table_id: tableId, ...STANDARD_FIELD_CONFIG },
      credentials: { app_id: appId, app_secret: appSecret },
    };
  }

  // --- Create new Bitable ---
  let defaultTableId: string;
  let bitableUrl: string;
  s.start("Creating Bitable app...");
  try {
    const app = await setupApi.createApp("Symphony Tracker");
    appToken = app.app_token;
    defaultTableId = app.table_id;
    bitableUrl = app.url;
    s.stop("Bitable app created");
  } catch (err) {
    s.stop("Failed to create Bitable app");
    p.log.error(`${err instanceof Error ? err.message : String(err)}`);
    return { config: {} };
  }

  s.start("Creating standard table...");
  try {
    const table = await setupApi.createTable(appToken, "任务");
    tableId = table.table_id;
    s.stop("Table created");
  } catch (err) {
    s.stop("Failed to create table");
    p.log.error(`${err instanceof Error ? err.message : String(err)}`);
    return { config: {} };
  }

  // Delete default empty table
  if (defaultTableId && defaultTableId !== tableId) {
    s.start("Cleaning up default table...");
    try {
      await setupApi.deleteTable(appToken, defaultTableId);
      s.stop("Default table removed");
    } catch {
      s.stop("Could not remove default table (you can delete it manually)");
    }
  }

  p.log.success(`Bitable URL: ${bitableUrl}`);

  // Transfer ownership
  const phone = await p.text({
    message: "请输入你的手机号（用于转让多维表格所有权，可直接回车跳过）",
    placeholder: "13800138000",
  });
  if (!p.isCancel(phone) && (phone as string).trim()) {
    const ts = p.spinner();
    try {
      ts.start("正在查询用户信息...");
      const openId = await setupApi.lookupUserByMobile((phone as string).trim());
      ts.stop("用户查询成功");

      ts.start("正在转让所有权...");
      await setupApi.transferOwnership(appToken, openId);
      ts.stop("所有权已转让给你，机器人保留管理权限");
    } catch (err) {
      ts.stop("所有权转让失败");
      p.log.warn(`转让失败: ${err instanceof Error ? err.message : String(err)}`);
      p.log.info("你可以在飞书中手动添加自己为多维表格协作者");
    }
  } else if (p.isCancel(phone)) {
    // User pressed ctrl+c — skip
  } else {
    p.log.info("已跳过所有权转让。你需要在飞书中手动添加自己为多维表格协作者。");
  }

  return {
    config: { kind: "feishu_bitable", app_token: appToken, table_id: tableId, ...STANDARD_FIELD_CONFIG },
    credentials: { app_id: appId, app_secret: appSecret },
  };
};

function validateFeishuBitableConfig(config: Record<string, unknown>): string | null {
  if (!config.app_token) return "tracker.app_token is required (set in WORKFLOW.md or ~/.open-symphony/settings.json)";
  if (!config.table_id) return "tracker.table_id is required (set in WORKFLOW.md or ~/.open-symphony/settings.json)";
  if (!config.app_id) return "tracker.app_id is required (set in WORKFLOW.md, ~/.open-symphony/settings.json, or $FEISHU_APP_ID)";
  if (!config.app_secret) return "tracker.app_secret is required (set in WORKFLOW.md, ~/.open-symphony/settings.json, or $FEISHU_APP_SECRET)";
  if (!config.state_field) return "tracker.state_field is required for feishu_bitable";
  if (!config.identifier_field) return "tracker.identifier_field is required for feishu_bitable";
  if (!config.title_field) return "tracker.title_field is required for feishu_bitable";
  return null;
}

registerTracker("feishu_bitable", createFeishuBitableAdapter, feishuBitableSetup, {
  label: "飞书多维表格 (Feishu Bitable)",
  description: "使用飞书多维表格作为看板，可视化任务管理",
  recommended: true,
  category: "feishu",
}, validateFeishuBitableConfig);
