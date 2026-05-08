import { resolve } from "node:path";
import { homedir } from "node:os";

export const DIR_NAME = ".open-symphony";

export function symphonyHome(home?: string): string {
  return resolve(home ?? homedir(), DIR_NAME);
}

export function symphonyDb(home?: string): string {
  return resolve(symphonyHome(home), "symphony.db");
}

export function symphonySettings(home?: string): string {
  return resolve(symphonyHome(home), "settings.json");
}

export function symphonyLogsDir(home?: string): string {
  return resolve(symphonyHome(home), "logs");
}

export function symphonyWorkflow(home?: string): string {
  return resolve(symphonyHome(home), "WORKFLOW.md");
}

export function symphonyWorkspaceRoot(home?: string): string {
  return resolve(symphonyHome(home), "workspace");
}
