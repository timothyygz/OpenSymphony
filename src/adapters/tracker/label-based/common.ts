import type { Issue, TokenUsage } from "../../../model/index.ts";
import type { HealthCheckResult } from "../types.ts";
import { logger } from "../../../logging/logger.ts";

export const SYMPHONY_LABEL_PREFIX = "symphony::";

export const DEFAULT_SYMPHONY_LABELS = [
  { name: "symphony::Todo", color: "0075ca" },
  { name: "symphony::In Progress", color: "fbca04" },
  { name: "symphony::Done", color: "0e8a16" },
  { name: "symphony::Cancelled", color: "b60205" },
];

// --- Label normalization ---

export function normalizeLabels(labels: string[] | Array<{ name: string }>): string[] {
  if (labels.length === 0) return [];
  return typeof labels[0] === "string"
    ? (labels as string[])
    : (labels as Array<{ name: string }>).map((l) => l.name);
}

// --- Label state extraction ---

export function extractSymphonyState(labels: string[], labelPrefix: string, fallbackState: string): string {
  for (const label of labels) {
    if (label.startsWith(labelPrefix)) {
      return label.slice(labelPrefix.length);
    }
  }
  return fallbackState;
}

export function extractNonSymphonyLabels(labels: string[], labelPrefix: string): string[] {
  return labels.filter((l) => !l.startsWith(labelPrefix));
}

// --- HTML comment metadata ---

export function buildMetadataMarker(key: string, value: string): string {
  return `<!-- symphony-${key}: ${value} -->`;
}

export function cleanMetadataFromBody(body: string, key: string): string {
  return body.replace(new RegExp(`<!-- symphony-${key}: .*? -->`, "g"), "").trimEnd();
}

export function appendMetadataToBody(body: string, key: string, value: string): string {
  const cleaned = cleanMetadataFromBody(body, key);
  return `${cleaned}\n\n${buildMetadataMarker(key, value)}`;
}

// --- Fetch helpers ---

export interface FetchByStatesParams<R> {
  states: string[];
  labelPrefix: string;
  listFn: (params: Record<string, string>) => Promise<R[]>;
  mapFn: (raw: R) => Issue;
  openStateValue: string;
}

export async function fetchIssuesByLabelStates<R>(params: FetchByStatesParams<R>): Promise<Issue[]> {
  const { states, labelPrefix, listFn, mapFn, openStateValue } = params;

  if (states.length === 0) return [];

  if (states.length === 1 && states[0] === "*") {
    const issues = await listFn({ state: openStateValue, per_page: "100" });
    return issues.map(mapFn);
  }

  const seen = new Set<number>();
  const results: Issue[] = [];
  for (const state of states) {
    const label = `${labelPrefix}${state}`;
    const issues = await listFn({ labels: label, state: openStateValue, per_page: "100" });
    for (const issue of issues) {
      const id = typeof (issue as Record<string, unknown>).id === "number"
        ? (issue as Record<string, unknown>).id as number
        : Number((issue as Record<string, unknown>).id);
      if (!seen.has(id)) {
        seen.add(id);
        results.push(mapFn(issue));
      }
    }
  }
  return results;
}

export interface FetchByIdsParams<R> {
  ids: string[];
  getFn: (id: number) => Promise<R>;
  mapFn: (raw: R) => Issue;
  kind: string;
}

export async function fetchIssuesByIds<R>(params: FetchByIdsParams<R>): Promise<Issue[]> {
  const { ids, getFn, mapFn, kind } = params;
  if (ids.length === 0) return [];

  const results: Issue[] = [];
  for (const id of ids) {
    try {
      const issue = await getFn(Number(id));
      results.push(mapFn(issue));
    } catch (err) {
      logger.warn({ issueId: id, error: String(err) }, `Failed to fetch ${kind} issue`);
    }
  }
  return results;
}

// --- State update helper ---

export interface UpdateLabelStateParams<R> {
  issueId: string;
  state: string;
  labelPrefix: string;
  getFn: (id: number) => Promise<R>;
  updateFn: (id: number, data: Record<string, unknown>) => Promise<unknown>;
  getLabels: (raw: R) => string[];
  buildLabelsParam: (labels: string[]) => unknown;
}

export async function updateLabelState<R>(params: UpdateLabelStateParams<R>): Promise<void> {
  const { issueId, state, labelPrefix, getFn, updateFn, getLabels, buildLabelsParam } = params;

  const issue = await getFn(Number(issueId));
  const rawLabels = getLabels(issue);
  const normalized = normalizeLabels(rawLabels);
  const nonSymphonyLabels = extractNonSymphonyLabels(normalized, labelPrefix);
  const newLabel = `${labelPrefix}${state}`;
  const labels = [...nonSymphonyLabels, newLabel];

  await updateFn(Number(issueId), { labels: buildLabelsParam(labels) });
  logger.info({ issueId, state }, "Updated issue state in tracker");
}

// --- Body metadata update helper ---

export interface UpdateBodyMetadataParams<R> {
  issueId: string;
  metadataKey: string;
  value: string;
  getFn: (id: number) => Promise<R>;
  updateFn: (id: number, data: Record<string, unknown>) => Promise<unknown>;
  getBody: (raw: R) => string | null;
  buildBodyParam: (body: string) => unknown;
  kind: string;
}

export async function updateBodyMetadata<R>(params: UpdateBodyMetadataParams<R>): Promise<void> {
  const { issueId, metadataKey, value, getFn, updateFn, getBody, buildBodyParam, kind } = params;

  const issue = await getFn(Number(issueId));
  const body = getBody(issue) ?? "";
  const updated = appendMetadataToBody(body, metadataKey, value);
  await updateFn(Number(issueId), { body: buildBodyParam(updated) });
  logger.info({ issueId }, `Updated issue ${metadataKey} in ${kind} tracker`);
}

// --- Token update helper ---

export interface UpdateTokensParams<R> {
  issueId: string;
  tokens: TokenUsage;
  getFn: (id: number) => Promise<R>;
  updateFn: (id: number, data: Record<string, unknown>) => Promise<unknown>;
  getBody: (raw: R) => string | null;
  buildBodyParam: (body: string) => unknown;
  kind: string;
}

export async function updateTokens<R>(params: UpdateTokensParams<R>): Promise<void> {
  const { issueId, tokens, getFn, updateFn, getBody, buildBodyParam, kind } = params;

  const issue = await getFn(Number(issueId));
  const body = getBody(issue) ?? "";
  const marker = buildMetadataMarker("tokens", JSON.stringify(tokens));
  const cleaned = cleanMetadataFromBody(body, "tokens");
  await updateFn(Number(issueId), { body: buildBodyParam(`${cleaned}\n\n${marker}`) });
  logger.info({ issueId, totalTokens: tokens.totalTokens }, `Updated issue tokens in ${kind} tracker`);
}

// --- Health check ---

export interface HealthCheckParams {
  connectionTestFn: () => Promise<{ name: string }>;
  listFn: (params: Record<string, string>) => Promise<unknown[]>;
  connectivityName: string;
  accessName: string;
}

export async function healthCheckSequence(params: HealthCheckParams): Promise<HealthCheckResult[]> {
  const { connectionTestFn, listFn, connectivityName, accessName } = params;
  const results: HealthCheckResult[] = [];

  try {
    const resource = await connectionTestFn();
    results.push({ name: connectivityName, status: "pass", message: `Connected to ${resource.name}` });
  } catch (err) {
    results.push({ name: connectivityName, status: "fail", message: err instanceof Error ? err.message : String(err) });
    return results;
  }

  try {
    await listFn({ per_page: "1" });
    results.push({ name: accessName, status: "pass", message: "Can list issues" });
  } catch (err) {
    results.push({ name: accessName, status: "fail", message: err instanceof Error ? err.message : String(err) });
  }

  return results;
}
