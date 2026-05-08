import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { WizardResult } from "./types.ts";

// --- Constants ---

export const TEMPLATE_PRESETS = [
  { name: "英文模板 (English)" as const, file: "basic.md", description: "英文基础模板：包含完整的工单处理指引，适合通用场景" },
  { name: "中文模板 (Chinese)" as const, file: "chinese.md", description: "中文基础模板：与英文模板功能一致，使用中文提示" },
  { name: "空模板 (Empty)" as const, file: "empty.md", description: "仅包含工单标题和描述，可自由定制" },
];

// --- Pure functions ---

export function loadTemplate(file: string): string {
  const templateDir = resolve(import.meta.dir, "templates");
  return readFileSync(resolve(templateDir, file), "utf-8");
}

export function objectToYaml(obj: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (obj === null || obj === undefined) return "";
  if (typeof obj === "string")
    return obj.includes("\n")
      ? `|\n${obj
          .split("\n")
          .map((l) => `${pad}  ${l}`)
          .join("\n")}`
      : obj.includes(":") || obj.includes("#")
        ? `"${obj}"`
        : obj;
  if (typeof obj === "number" || typeof obj === "boolean") return String(obj);
  if (Array.isArray(obj)) {
    if (obj.length === 0) return "[]";
    return obj
      .map((v) => {
        if (typeof v === "object" && v !== null && !Array.isArray(v)) {
          const entries = Object.entries(v as Record<string, unknown>);
          if (entries.length === 0) return `${pad}- {}`;
          const [firstKey, firstVal] = entries[0]!;
          const rest = entries.slice(1);
          let line = `${pad}- ${firstKey}: ${scalarYaml(firstVal)}`;
          for (const [k, val] of rest) {
            line += `\n${pad}  ${k}: ${scalarYaml(val)}`;
          }
          return line;
        }
        return `${pad}- ${scalarYaml(v)}`;
      })
      .join("\n");
  }
  if (typeof obj === "object") {
    const entries = Object.entries(obj as Record<string, unknown>);
    return entries
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => {
        if (v === null) return `${pad}${k}: null`;
        if (typeof v === "object" && v !== null) {
          if (Array.isArray(v) && (v as unknown[]).length === 0)
            return `${pad}${k}: []`;
          const sub = objectToYaml(v, indent + 1);
          return `${pad}${k}:\n${sub}`;
        }
        return `${pad}${k}: ${scalarYaml(v)}`;
      })
      .join("\n");
  }
  return String(obj);
}

export function scalarYaml(v: unknown): string {
  if (typeof v === "string") {
    if (v.startsWith("$")) return `"${v}"`;
    if (v.includes(":") || v.includes("#") || v.includes("'")) return `"${v}"`;
    return v;
  }
  if (v === null || v === undefined) return "null";
  return String(v);
}

export function buildWorkflowYaml(result: WizardResult): string {
  const template = loadTemplate("workflow-config.yaml");
  const workspaceYaml = objectToYaml(result.workspace, 1);
  const trackerYaml = objectToYaml(result.tracker, 1);

  const agentConfig = result.agent as Record<string, unknown>;
  const approvalPolicy = String(
    (agentConfig.config as Record<string, unknown> | undefined)?.approval_policy ?? "auto",
  );

  // Remove the hardcoded tracker block from template and inject generated one
  let yaml = template
    .replace(/^tracker:[\s\S]*?(?=\npolling:)/m, "")
    .replace("{{ workspace }}", workspaceYaml)
    .replace("{{ approval_policy }}", approvalPolicy);

  yaml = `tracker:\n${trackerYaml}\n${yaml}`;

  return `---\n${yaml}\n---\n\n${result.promptTemplate}\n`;
}

export interface ParsedWorkflow {
  tracker: Record<string, unknown>;
  workspace: Record<string, unknown>;
  agent: Record<string, unknown>;
  promptTemplate: string;
}

export function parseWorkflowFile(content: string): ParsedWorkflow | null {
  // WORKFLOW.md format: "---\nyaml\n---\ntemplate"
  const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!yamlMatch) return null;

  try {
    const parsed = parseYaml(yamlMatch[1]!) as Record<string, unknown>;
    if (!parsed) return null;

    // Template is everything after the second ---
    const templatePart = content.slice(content.indexOf("---", 3) + 3).trimStart();

    return {
      tracker: (parsed.tracker as Record<string, unknown>) ?? {},
      workspace: (parsed.workspace as Record<string, unknown>) ?? {},
      agent: (parsed.agent as Record<string, unknown>) ?? {},
      promptTemplate: templatePart || "",
    };
  } catch {
    return null;
  }
}
