---
name: dws-chat-summary
description: 读取钉钉群聊消息并总结内容。This skill should be used when the user asks to check, read, or summarize DingTalk group chat messages, or mentions wanting to know what was discussed in a group chat. Supports time range filtering and per-speaker summarization.
---

# DWS Chat Summary

Read DingTalk group chat messages via `dws` CLI, then summarize the content. Supports time range filtering and focusing on specific speakers.

## Prerequisites

The following variables must be present in the project `.env` file:

```env
DWS_CHAT_GROUP_NAME=<group name, used to search for the conversation>
DWS_WEBHOOK_TOKEN=<webhook access_token for sending messages (optional)>
DWS_WEBHOOK_SECRET=<webhook secret for signing requests (optional)>
```

On first invocation, verify `.env` has `DWS_CHAT_GROUP_NAME` set. If missing, prompt the user to add it.

## Workflow

### 1. Resolve Group

```bash
dws chat search --query "<DWS_CHAT_GROUP_NAME>" --format json
```

Extract `openConversationId` from the result. If not found, ask the user to confirm the group name.

### 2. Fetch Messages

Use the resolved `openConversationId` to fetch messages within the requested time range:

```bash
dws chat message list --group "<openConversationId>" --time "<start_time>" --format json
```

- `--time` format: `"YYYY-MM-DD HH:mm:ss"` (start of range)
- Messages are returned newest-first, paginated via `nextCursor`
- If `hasMore` is true, continue fetching with the cursor until all messages in the range are collected
- For "today", use `"YYYY-MM-DD 00:00:00"` as the start time

### 3. Filter and Summarize

After collecting all messages:

- If the user specifies people to focus on, filter messages by `sender` field
- Summarize by speaker, grouping related topics
- For each speaker, list the problems/questions/requests they raised
- Include timestamps for context
- Note: sender names in the API may differ from user input (e.g., 贾孟雪 vs 贾梦雪) - use fuzzy matching

### 4. Send Messages (Optional)

If the user asks to send a message to the group and `DWS_WEBHOOK_TOKEN` / `DWS_WEBHOOK_SECRET` are configured:

Use the bundled script:

```bash
python3 scripts/send_webhook.py --text "<message>"
```

Or call directly via curl if the script is unavailable.

## Tips

- Image messages appear as `[图片消息](mediaId=...)` - note these exist but content is not readable
- File messages appear as `[文件] filename.xlsx`
- `quotedMessage` in a message indicates it's a reply - include the quoted context for clarity
- `emotionReplyList` shows emoji reactions (e.g., OK) - useful for understanding acknowledgment
