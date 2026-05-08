import type { Issue } from "../../../model/index.ts";
import type { GitHubIssueResponse } from "./api.ts";

const SYMPHONY_LABEL_PREFIX = "symphony::";

export function extractSymphonyState(labels: Array<{ name: string }>, fallbackState: string): string {
  for (const label of labels) {
    if (label.name.startsWith(SYMPHONY_LABEL_PREFIX)) {
      return label.name.slice(SYMPHONY_LABEL_PREFIX.length);
    }
  }
  return fallbackState;
}

export function extractNonSymphonyLabels(labels: Array<{ name: string }>): string[] {
  return labels
    .map((l) => l.name)
    .filter((n) => !n.startsWith(SYMPHONY_LABEL_PREFIX));
}

export function mapGitHubIssueToIssue(issue: GitHubIssueResponse): Issue {
  return {
    id: String(issue.number),
    identifier: `#${issue.number}`,
    title: issue.title,
    description: issue.body,
    priority: null,
    state: extractSymphonyState(issue.labels, issue.state),
    branchName: null,
    url: issue.html_url,
    labels: extractNonSymphonyLabels(issue.labels),
    blockedBy: [],
    createdAt: issue.created_at ? new Date(issue.created_at) : null,
    updatedAt: issue.updated_at ? new Date(issue.updated_at) : null,
  };
}
