import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { WorkflowDefinition } from "../model/index.ts";
import { MissingWorkflowFileError, WorkflowParseError, WorkflowFrontMatterNotMapError } from "../errors/errors.ts";
import { logger } from "../logging/logger.ts";

export function resolveWorkflowPath(explicitPath?: string): string {
  if (explicitPath) {
    return resolve(explicitPath);
  }
  return resolve(process.cwd(), "WORKFLOW.md");
}

export function loadWorkflow(filePath: string): WorkflowDefinition {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    throw new MissingWorkflowFileError(filePath);
  }

  return parseWorkflowContent(content);
}

export function parseWorkflowContent(content: string): WorkflowDefinition {
  let config: Record<string, unknown> = {};
  let promptTemplate: string;

  if (content.startsWith("---")) {
    const endIndex = content.indexOf("\n---", 3);
    if (endIndex === -1) {
      throw new WorkflowParseError("Unclosed YAML front matter (missing closing ---)");
    }

    const yamlContent = content.slice(3, endIndex);
    try {
      const parsed = parseYaml(yamlContent);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new WorkflowFrontMatterNotMapError();
      }
      config = parsed as Record<string, unknown>;
    } catch (err) {
      if (err instanceof WorkflowFrontMatterNotMapError) throw err;
      throw new WorkflowParseError(String(err));
    }

    promptTemplate = content.slice(endIndex + 4).trim();
  } else {
    promptTemplate = content.trim();
  }

  logger.debug({ configKeys: Object.keys(config), hasPrompt: promptTemplate.length > 0 }, "Workflow loaded");

  return { config, promptTemplate };
}
