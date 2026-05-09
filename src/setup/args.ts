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
        if (i + 1 >= args.length || args[i + 1]!.startsWith("-")) {
          console.error("--tracker requires a value");
          process.exit(1);
        }
        result.tracker = args[++i];
        break;
      case "--template":
        if (i + 1 >= args.length || args[i + 1]!.startsWith("-")) {
          console.error("--template requires a value");
          process.exit(1);
        }
        result.template = args[++i];
        break;
      case "--approval-policy":
        if (i + 1 >= args.length || args[i + 1]!.startsWith("-")) {
          console.error("--approval-policy requires a value");
          process.exit(1);
        }
        result.approvalPolicy = args[++i];
        break;
      case "--workspace-root":
        if (i + 1 >= args.length || args[i + 1]!.startsWith("-")) {
          console.error("--workspace-root requires a value");
          process.exit(1);
        }
        result.workspaceRoot = args[++i];
        break;
      case "--app-id":
        if (i + 1 >= args.length || args[i + 1]!.startsWith("-")) {
          console.error("--app-id requires a value");
          process.exit(1);
        }
        result.appId = args[++i];
        break;
      case "--app-secret":
        if (i + 1 >= args.length || args[i + 1]!.startsWith("-")) {
          console.error("--app-secret requires a value");
          process.exit(1);
        }
        result.appSecret = args[++i];
        break;
      case "--app-token":
        if (i + 1 >= args.length || args[i + 1]!.startsWith("-")) {
          console.error("--app-token requires a value");
          process.exit(1);
        }
        result.appToken = args[++i];
        break;
      case "--table-id":
        if (i + 1 >= args.length || args[i + 1]!.startsWith("-")) {
          console.error("--table-id requires a value");
          process.exit(1);
        }
        result.tableId = args[++i];
        break;
      case "--gitlab-host":
        if (i + 1 >= args.length || args[i + 1]!.startsWith("-")) {
          console.error("--gitlab-host requires a value");
          process.exit(1);
        }
        result.gitlabHost = args[++i];
        break;
      case "--gitlab-token":
        if (i + 1 >= args.length || args[i + 1]!.startsWith("-")) {
          console.error("--gitlab-token requires a value");
          process.exit(1);
        }
        result.gitlabToken = args[++i];
        break;
      case "--project-id":
        if (i + 1 >= args.length || args[i + 1]!.startsWith("-")) {
          console.error("--project-id requires a value");
          process.exit(1);
        }
        result.projectId = args[++i];
        break;
      case "--active-states":
        if (i + 1 >= args.length || args[i + 1]!.startsWith("-")) {
          console.error("--active-states requires a value");
          process.exit(1);
        }
        result.activeStates = args[++i];
        break;
      case "--terminal-states":
        if (i + 1 >= args.length || args[i + 1]!.startsWith("-")) {
          console.error("--terminal-states requires a value");
          process.exit(1);
        }
        result.terminalStates = args[++i];
        break;
      case "--github-host":
        if (i + 1 >= args.length || args[i + 1]!.startsWith("-")) {
          console.error("--github-host requires a value");
          process.exit(1);
        }
        result.githubHost = args[++i];
        break;
      case "--github-token":
        if (i + 1 >= args.length || args[i + 1]!.startsWith("-")) {
          console.error("--github-token requires a value");
          process.exit(1);
        }
        result.githubToken = args[++i];
        break;
      case "--github-owner":
        if (i + 1 >= args.length || args[i + 1]!.startsWith("-")) {
          console.error("--github-owner requires a value");
          process.exit(1);
        }
        result.githubOwner = args[++i];
        break;
      case "--github-repo":
        if (i + 1 >= args.length || args[i + 1]!.startsWith("-")) {
          console.error("--github-repo requires a value");
          process.exit(1);
        }
        result.githubRepo = args[++i];
        break;
      case "--workspace-type":
        if (i + 1 >= args.length || args[i + 1]!.startsWith("-")) {
          console.error("--workspace-type requires a value");
          process.exit(1);
        }
        result.workspaceType = args[++i];
        break;
      case "--git-url":
        if (i + 1 >= args.length || args[i + 1]!.startsWith("-")) {
          console.error("--git-url requires a value");
          process.exit(1);
        }
        result.gitUrl = args[++i];
        break;
      case "--git-path":
        if (i + 1 >= args.length || args[i + 1]!.startsWith("-")) {
          console.error("--git-path requires a value");
          process.exit(1);
        }
        result.gitPath = args[++i];
        break;
      case "--git-branch":
        if (i + 1 >= args.length || args[i + 1]!.startsWith("-")) {
          console.error("--git-branch requires a value");
          process.exit(1);
        }
        result.gitBranch = args[++i];
        break;
      case "--git-repo":
        if (i + 1 >= args.length || args[i + 1]!.startsWith("-")) {
          console.error("--git-repo requires a value");
          process.exit(1);
        }
        result.gitRepo = args[++i];
        break;
      case "--export":
        if (i + 1 >= args.length || args[i + 1]!.startsWith("-")) {
          console.error("--export requires a value");
          process.exit(1);
        }
        result.exportPath = args[++i];
        break;
      case "--import":
        if (i + 1 >= args.length || args[i + 1]!.startsWith("-")) {
          console.error("--import requires a value");
          process.exit(1);
        }
        result.importPath = args[++i];
        break;
      case "--dry-run":
        result.dryRun = true;
        break;
    }
  }

  return result;
}
