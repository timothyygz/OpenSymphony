#!/usr/bin/env bun
/**
 * seed.ts - 初始化 JSON Tracker 示例数据
 *
 * 用法: bun run examples/json-tracker/seed.ts
 *
 * 会创建 tracker-data.json 并写入几条示例任务
 */

import { JsonTrackerApi } from "./api.ts";
import type { JsonTrackerConfig } from "./types.ts";

const config: JsonTrackerConfig = {
  filePath: "./tracker-data.json",
  activeStates: ["待处理"],
  terminalStates: ["已完成", "已取消"],
};

const api = new JsonTrackerApi(config);
api.init();

// 写入示例数据
const created = api.seedRecords([
  {
    title: "修复登录页面样式错乱",
    description: "登录页面在移动端显示异常，输入框和按钮重叠。需要修复 CSS 响应式布局。",
    priority: 1,
    state: "待处理",
    labels: ["bug", "frontend"],
  },
  {
    title: "添加用户头像上传功能",
    description: "用户个人设置页面需要支持上传头像，限制 2MB 以内，支持 JPG/PNG 格式。",
    priority: 2,
    state: "待处理",
    labels: ["feature", "frontend"],
  },
  {
    title: "优化数据库查询性能",
    description: "订单列表查询在数据量大时响应缓慢，需要添加索引并优化 SQL 查询。",
    priority: 1,
    state: "待处理",
    labels: ["performance", "backend"],
  },
  {
    title: "编写 API 接口文档",
    description: "为 v2 版本的所有 REST API 编写 OpenAPI 文档。",
    priority: 3,
    state: "待处理",
    labels: ["documentation"],
  },
  {
    title: "已完成的历史任务",
    description: "这个任务已经完成了。",
    priority: null,
    state: "已完成",
    labels: ["done"],
  },
]);

console.log(`✅ 已创建 ${created.length} 条示例任务：`);
for (const record of created) {
  console.log(`   ${record.identifier} [${record.state}] ${record.title}`);
}
console.log(`\n📝 数据文件: ${config.filePath}`);
