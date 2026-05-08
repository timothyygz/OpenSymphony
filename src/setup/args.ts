/**
 * CLI argument parsing for `opensymphony init`.
 */

export type { InitArgs } from "./types.ts";
import type { InitArgs } from "./types.ts";

/**
 * Parse CLI arguments for the init command.
 * Extracts flags and returns a structured InitArgs object.
 */
export function parseArgs(args: string[]): InitArgs {
  const result: InitArgs = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith("-")) continue;

    switch (arg) {
      case "--non-interactive":
        result.nonInteractive = true;
        break;
      case "--tracker":
        result.tracker = args[++i];
        break;
      case "--template":
        result.template = args[++i];
        break;
      case "--approval-policy":
        result.approvalPolicy = args[++i];
        break;
      case "--workspace-root":
        result.workspaceRoot = args[++i];
        break;
      case "--app-id":
        result.appId = args[++i];
        break;
      case "--app-secret":
        result.appSecret = args[++i];
        break;
      case "--app-token":
        result.appToken = args[++i];
        break;
      case "--table-id":
        result.tableId = args[++i];
        break;
      case "--gitlab-host":
        result.gitlabHost = args[++i];
        break;
      case "--gitlab-token":
        result.gitlabToken = args[++i];
        break;
      case "--project-id":
        result.projectId = args[++i];
        break;
      case "--active-states":
        result.activeStates = args[++i];
        break;
      case "--terminal-states":
        result.terminalStates = args[++i];
        break;
      case "--github-host":
        result.githubHost = args[++i];
        break;
      case "--github-token":
        result.githubToken = args[++i];
        break;
      case "--github-owner":
        result.githubOwner = args[++i];
        break;
      case "--github-repo":
        result.githubRepo = args[++i];
        break;
      case "--workspace-type":
        result.workspaceType = args[++i];
        break;
      case "--git-url":
        result.gitUrl = args[++i];
        break;
      case "--git-path":
        result.gitPath = args[++i];
        break;
      case "--git-branch":
        result.gitBranch = args[++i];
        break;
      case "--git-repo":
        result.gitRepo = args[++i];
        break;
      case "--export":
        result.exportPath = args[++i];
        break;
      case "--import":
        result.importPath = args[++i];
        break;
      case "--dry-run":
        result.dryRun = true;
        break;
    }
  }

  return result;
}
