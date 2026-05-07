import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { TrackerAdapter } from "../../tracker/types.ts";

export function createTrackerTool(adapter: TrackerAdapter, issueId: string) {
  return tool(
    "tracker_tool",
    "Interact with the tracker to create, read, update and search task records. " +
      "Use this to report progress, write result summaries, update task state, and create new tasks. " +
      "Actions: 'create' creates a new record, 'get' retrieves a single record, " +
      "'update' modifies record fields, 'list' returns all records, 'search' filters records by keyword.",
    {
      action: z
        .enum(["create", "get", "update", "list", "search"])
        .describe("Operation to perform: create/get/update/list/search"),
      record_id: z
        .string()
        .optional()
        .describe(
          "Record ID. Required for 'get' and 'update'. Defaults to current task record ID.",
        ),
      fields: z
        .record(z.unknown())
        .optional()
        .describe(
          "Fields for the record (key-value pairs). Used with 'create' and 'update' actions.",
        ),
      query: z
        .string()
        .optional()
        .describe(
          "Search query string for 'search' action.",
        ),
    },
    async (args) => {
      try {
        const recordId = args.record_id ?? issueId;

        switch (args.action) {
          case "create": {
            const title = (args.fields?.title as string) ?? "";
            if (!title) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: "No title provided to create record",
                  },
                ],
                isError: true,
              };
            }
            const issue = await adapter.createIssue({
              title,
              description: args.fields?.description as string | undefined,
              state: args.fields?.state as string | undefined,
              labels: args.fields?.labels as string[] | undefined,
            });
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(issue, null, 2),
                },
              ],
            };
          }
          case "get": {
            const issues = await adapter.fetchIssueStatesByIds([recordId]);
            const issue = issues[0];
            if (!issue) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Record ${recordId} not found`,
                  },
                ],
                isError: true,
              };
            }
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(issue, null, 2),
                },
              ],
            };
          }
          case "update": {
            if (!args.fields || Object.keys(args.fields).length === 0) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: "No fields provided to update",
                  },
                ],
                isError: true,
              };
            }
            if (args.fields.state) {
              await adapter.updateIssueState(recordId, args.fields.state as string);
            }
            if (args.fields.progress && adapter.updateIssueProgress) {
              await adapter.updateIssueProgress(recordId, args.fields.progress as string);
            }
            if (args.fields.result_summary && adapter.updateIssueResultSummary) {
              await adapter.updateIssueResultSummary(recordId, args.fields.result_summary as string);
            }
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Record ${recordId} updated successfully`,
                },
              ],
            };
          }
          case "list": {
            const issues = await adapter.fetchIssuesByStates(["*"]);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(issues, null, 2),
                },
              ],
            };
          }
          case "search": {
            if (!args.query) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: "Query is required for search action",
                  },
                ],
                isError: true,
              };
            }
            const issues = await adapter.searchIssues(args.query);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(issues, null, 2),
                },
              ],
            };
          }
        }
      } catch (err) {
        return {
          content: [
            { type: "text" as const, text: `Tracker operation failed: ${err}` },
          ],
          isError: true,
        };
      }
    },
  );
}

export function createTrackerMcpServer(adapter: TrackerAdapter, issueId: string) {
  return createSdkMcpServer({
    name: "tracker",
    alwaysLoad: true,
    tools: [createTrackerTool(adapter, issueId)],
  });
}
