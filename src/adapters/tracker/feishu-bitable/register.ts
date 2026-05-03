import { registerTracker } from "../registry.ts";
import { createFeishuBitableAdapter } from "./adapter.ts";

registerTracker("feishu_bitable", createFeishuBitableAdapter);
