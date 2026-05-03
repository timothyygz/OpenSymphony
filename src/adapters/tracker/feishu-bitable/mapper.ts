import type { Issue } from "../../../model/index.ts";
import type { BitableRecord } from "./api.ts";

export interface FieldMapping {
  stateField: string;
  identifierField: string;
  titleField: string;
  descriptionField: string;
  priorityField?: string;
  labelsField?: string;
}

export function mapRecordToIssue(record: BitableRecord, mapping: FieldMapping): Issue {
  const fields = record.fields;

  return {
    id: record.record_id,
    identifier: extractString(fields[mapping.identifierField]) ?? record.record_id,
    title: extractString(fields[mapping.titleField]) ?? "",
    description: extractString(fields[mapping.descriptionField]) ?? null,
    priority: mapping.priorityField ? extractInt(fields[mapping.priorityField]) : null,
    state: extractString(fields[mapping.stateField]) ?? "",
    branchName: null,
    url: null,
    labels: mapping.labelsField ? extractStringArray(fields[mapping.labelsField]) : [],
    blockedBy: [], // v1: always empty for Feishu Bitable
    createdAt: record.created_time ? new Date(record.created_time * 1000) : null,
    updatedAt: record.last_modified_time ? new Date(record.last_modified_time * 1000) : null,
  };
}

function extractString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim();
  // Feishu bitable text fields can be objects with "text" or "link" properties
  if (typeof value === "object" && value !== null) {
    // Rich text: direct array of {text: string, ...}
    if (Array.isArray(value)) {
      return value
        .map((item) => {
          if (typeof item === "string") return item;
          if (typeof item === "object" && item !== null && "text" in item) {
            return String((item as Record<string, unknown>).text);
          }
          return "";
        })
        .join("")
        .trim() || null;
    }
    const obj = value as Record<string, unknown>;
    // Rich text: array of {text: string, ...}
    if (Array.isArray(obj.text)) {
      return (obj.text as Array<{ text: string }>).map((t) => t.text).join("");
    }
    if (typeof obj.text === "string") return obj.text;
    if (obj.link && typeof obj.link === "string") return obj.link;
  }
  return String(value);
}

function extractInt(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string") {
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function extractStringArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((v) => {
      if (typeof v === "string") return v.toLowerCase();
      if (typeof v === "object" && v !== null && "text" in v) {
        return String((v as Record<string, unknown>).text).toLowerCase();
      }
      return String(v).toLowerCase();
    });
  }
  return [String(value).toLowerCase()];
}
