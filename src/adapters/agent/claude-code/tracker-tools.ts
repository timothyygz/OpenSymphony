import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { FeishuBitableApi } from "../../tracker/feishu-bitable/api.ts";

export function createBitableTool(api: FeishuBitableApi, issueId: string) {
  return tool(
    "tracker_tool",
    "Interact with the tracker to create, read, update and search task records. " +
      "Use this to report progress, write result summaries, update task state, and create new tasks. " +
      "Actions: 'create' creates a new record, 'get' retrieves a single record, " +
      "'update' modifies record fields, 'list' returns all records, 'search' filters records by conditions.",
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
      filter: z
        .record(z.unknown())
        .optional()
        .describe(
          "Filter conditions for 'search' action (Feishu Bitable filter object).",
        ),
    },
    async (args) => {
      try {
        const recordId = args.record_id ?? issueId;

        switch (args.action) {
          case "create": {
            if (!args.fields || Object.keys(args.fields).length === 0) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: "No fields provided to create record",
                  },
                ],
                isError: true,
              };
            }
            const record = await api.createRecord(args.fields);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(record, null, 2),
                },
              ],
            };
          }
          case "get": {
            const records = await api.listRecords();
            const record = records.find((r) => r.record_id === recordId);
            if (!record) {
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
                  text: JSON.stringify(record, null, 2),
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
            await api.updateRecord(recordId, args.fields);
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
            const records = await api.listRecords();
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(records, null, 2),
                },
              ],
            };
          }
          case "search": {
            if (!args.filter) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: "Filter is required for search action",
                  },
                ],
                isError: true,
              };
            }
            const records = await api.searchRecords(args.filter);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(records, null, 2),
                },
              ],
            };
          }
        }
      } catch (err) {
        return {
          content: [
            { type: "text" as const, text: `Bitable operation failed: ${err}` },
          ],
          isError: true,
        };
      }
    },
  );
}

export function createTrackerMcpServer(api: FeishuBitableApi, issueId: string) {
  return createSdkMcpServer({
    name: "tracker",
    alwaysLoad: true,
    tools: [createBitableTool(api, issueId)],
  });
}
