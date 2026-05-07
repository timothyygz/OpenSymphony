import { resolve, dirname, basename, join } from "node:path";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";

export function sanitizeKey(identifier: string): string {
  return identifier.replace(/[^A-Za-z0-9._-]/g, "_");
}

/**
 * Resolve a path through symlinks by finding the nearest existing ancestor,
 * then appending the remaining non-existent components.
 * This ensures consistent prefix matching regardless of macOS /var → /private/var.
 */
function resolveReal(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    // Path doesn't exist — walk up to nearest existing ancestor
    let dir = resolve(p);
    const trailing: string[] = [];
    while (dir !== "/") {
      try {
        const real = realpathSync(dir);
        return trailing.length > 0 ? join(real, ...trailing) : real;
      } catch {
        trailing.unshift(basename(dir));
        dir = dirname(dir);
      }
    }
    return resolve(p); // ultimate fallback
  }
}

export function validateContainment(workspacePath: string, root: string): boolean {
  const resolved = resolveReal(workspacePath);
  const resolvedRoot = resolveReal(root);
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
