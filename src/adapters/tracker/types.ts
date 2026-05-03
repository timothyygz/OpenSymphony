import type { Issue } from "../../model/index.ts";

export interface TrackerAdapter {
  readonly kind: string;
  fetchCandidateIssues(): Promise<Issue[]>;
  fetchIssuesByStates(states: string[]): Promise<Issue[]>;
  fetchIssueStatesByIds(ids: string[]): Promise<Issue[]>;
  updateIssueState(issueId: string, state: string): Promise<void>;
}

export type TrackerAdapterFactory = (config: Record<string, unknown>) => TrackerAdapter;
