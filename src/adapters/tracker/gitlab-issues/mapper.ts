import type { Issue } from "../../../model/index.ts";
import type { GitLabIssueResponse } from "./api.ts";

const SYMPHONY_LABEL_PREFIX = "symphony::";

export function extractSymphonyState(labels: string[], fallbackState: string): string {
  for (const label of labels) {
    if (label.startsWith(SYMPHONY_LABEL_PREFIX)) {
      return label.slice(SYMPHONY_LABEL_PREFIX.length);
    }
  }
  return fallbackState;
}

export function extractNonSymphonyLabels(labels: string[]): string[] {
  return labels.filter((l) => !l.startsWith(SYMPHONY_LABEL_PREFIX));
}

export function mapGitLabIssueToIssue(issue: GitLabIssueResponse): Issue {
  return {
    id: String(issue.iid),
    identifier: issue.references.short,
    title: issue.title,
    description: issue.description,
    priority: issue.weight,
    state: extractSymphonyState(issue.labels, issue.state),
    branchName: null,
    url: issue.web_url,
    labels: extractNonSymphonyLabels(issue.labels),
    blockedBy: [],
    createdAt: issue.created_at ? new Date(issue.created_at) : null,
    updatedAt: issue.updated_at ? new Date(issue.updated_at) : null,
  };
}
