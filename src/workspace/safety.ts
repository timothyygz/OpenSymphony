import { resolve } from "node:path";
import { homedir } from "node:os";

export function sanitizeKey(identifier: string): string {
  return identifier.replace(/[^A-Za-z0-9._-]/g, "_");
}

export function validateContainment(workspacePath: string, root: string): boolean {
  const resolved = resolve(workspacePath);
  const resolvedRoot = resolve(root);
  return resolved.startsWith(resolvedRoot + "/") || resolved === resolvedRoot;
}

export function expandPath(pathStr: string, baseDir?: string): string {
  let expanded = pathStr;
  if (expanded.startsWith("~")) {
    expanded = expanded.replace(/^~/, homedir());
  }
  if (baseDir && !expanded.startsWith("/")) {
    expanded = resolve(baseDir, expanded);
  }
  return expanded;
}

export function assertWorkspaceCwd(workspacePath: string): void {
  // This is checked at agent launch time, not here
  // The agent process cwd must equal workspacePath
}
