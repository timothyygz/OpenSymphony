import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { WizardResult, ExportData } from "./types.ts";

// --- WizardResult <-> ExportData conversion ---

export function wizardResultToExportData(result: WizardResult): ExportData {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    tracker: {
      kind: (result.tracker.kind as string) ?? "unknown",
      config: { ...result.tracker },
      credentials: result.credentials ? { ...result.credentials } : undefined,
    },
    agent: { ...result.agent },
    workspace: { ...result.workspace },
    polling: {},
    promptTemplate: result.promptTemplate,
  };
}

export function exportDataToWizardResult(data: ExportData): WizardResult {
  return {
    tracker: { ...data.tracker.config },
    agent: { ...data.agent },
    workspace: { ...data.workspace },
    promptTemplate: data.promptTemplate,
    credentials: data.tracker.credentials
      ? { ...data.tracker.credentials }
      : undefined,
  };
}

// --- File I/O ---

export function writeExportFile(data: ExportData, filePath: string): void {
  const json = JSON.stringify(data, null, 2);
  writeFileSync(resolve(filePath), json + "\n");
}

export function readImportFile(
  filePath: string,
): { ok: true; data: ExportData } | { ok: false; errors: string[] } {
  const absPath = resolve(filePath);

  if (!existsSync(absPath)) {
    return { ok: false, errors: [`File not found: ${absPath}`] };
  }

  let raw: string;
  try {
    raw = readFileSync(absPath, "utf-8");
  } catch (err) {
    return {
      ok: false,
      errors: [
        `Cannot read file: ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      errors: [
        `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }

  return validateImportFile(parsed);
}

function validateImportFile(
  data: unknown,
): { ok: true; data: ExportData } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  if (!data || typeof data !== "object") {
    return { ok: false, errors: ["Import file must be a JSON object"] };
  }

  const obj = data as Record<string, unknown>;

  if (obj.version !== 1) {
    errors.push(
      `Unsupported version: ${obj.version ?? "missing"}. Expected: 1`,
    );
  }

  if (!obj.tracker || typeof obj.tracker !== "object") {
    errors.push("Missing or invalid 'tracker' field");
  } else {
    const tracker = obj.tracker as Record<string, unknown>;
    if (!tracker.kind) {
      errors.push("Missing 'tracker.kind' field");
    }
    if (!tracker.config || typeof tracker.config !== "object") {
      errors.push("Missing or invalid 'tracker.config' field");
    }
  }

  if (!obj.promptTemplate || typeof obj.promptTemplate !== "string") {
    errors.push("Missing or empty 'promptTemplate' field");
  }

  if (obj.agent === undefined || typeof obj.agent !== "object") {
    errors.push("Missing 'agent' field");
  }

  if (obj.workspace === undefined || typeof obj.workspace !== "object") {
    errors.push("Missing 'workspace' field");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, data: obj as unknown as ExportData };
}
