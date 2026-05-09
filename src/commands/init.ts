import * as p from "@clack/prompts";
import { homedir } from "node:os";
import { FeishuAuth } from "../adapters/tracker/feishu-bitable/auth.ts";
import { FeishuBitableSetupApi } from "../adapters/tracker/feishu-bitable/setup-api.ts";
import { initCommand } from "../setup/wizard.ts";
import type { InitDeps } from "../setup/types.ts";
import { registerCommand } from "./index.ts";

const deps: InitDeps = {
  prompts: p,
  createSetupApi: (appId, appSecret) =>
    new FeishuBitableSetupApi(new FeishuAuth(appId, appSecret)),
  checkClaudeCli: async () => {
    try {
      const proc = Bun.spawn(["which", "claude"], { stdout: "pipe", stderr: "pipe" });
      await proc.exited;
      return proc.exitCode === 0;
    } catch {
      return false;
    }
  },
  homedir,
};

registerCommand("init", (args) => initCommand(args, deps));
