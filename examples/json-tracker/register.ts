/**
 * JSON File Tracker - 注册入口
 *
 * 将适配器注册到全局 Tracker 注册表。
 * cli.ts 中只需 import 此文件即可完成注册。
 */

import { registerTracker } from "../../src/adapters/tracker/registry.ts";
import { createJsonTrackerAdapter } from "./adapter.ts";

registerTracker("json_file", createJsonTrackerAdapter);
