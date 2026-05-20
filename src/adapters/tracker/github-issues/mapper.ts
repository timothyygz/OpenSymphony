import type { Issue } from "../../../model/index.ts";
import type { GitHubIssueResponse } from "./api.ts";
import { SYMPHONY_LABEL_PREFIX, normalizeLabels, extractSymphonyState, extractNonSymphonyLabels } from "../label-based/common.ts";

export function mapGitHubIssueToIssue(issue: GitHubIssueResponse): Issue {
  const normalizedLabels = normalizeLabels(issue.labels);
  return {
    id: String(issue.number),
    identifier: `#${issue.number}`,
    title: issue.title,
    description: issue.body,
    priority: null,
    state: extractSymphonyState(normalizedLabels, SYMPHONY_LABEL_PREFIX, issue.state),
    branchName: null,
    url: issue.html_url,
    labels: extractNonSymphonyLabels(normalizedLabels, SYMPHONY_LABEL_PREFIX),
    blockedBy: [],
    createdAt: issue.created_at ? new Date(issue.created_at) : null,
    updatedAt: issue.updated_at ? new Date(issue.updated_at) : null,
  };
}
