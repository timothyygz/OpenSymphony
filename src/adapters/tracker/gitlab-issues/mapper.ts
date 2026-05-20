import type { Issue } from "../../../model/index.ts";
import type { GitLabIssueResponse } from "./api.ts";
import { SYMPHONY_LABEL_PREFIX, extractSymphonyState, extractNonSymphonyLabels } from "../label-based/common.ts";

export function mapGitLabIssueToIssue(issue: GitLabIssueResponse): Issue {
  return {
    id: String(issue.iid),
    identifier: issue.references.short,
    title: issue.title,
    description: issue.description,
    priority: issue.weight,
    state: extractSymphonyState(issue.labels, SYMPHONY_LABEL_PREFIX, issue.state),
    branchName: null,
    url: issue.web_url,
    labels: extractNonSymphonyLabels(issue.labels, SYMPHONY_LABEL_PREFIX),
    blockedBy: [],
    createdAt: issue.created_at ? new Date(issue.created_at) : null,
    updatedAt: issue.updated_at ? new Date(issue.updated_at) : null,
  };
}
