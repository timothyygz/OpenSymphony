import { spawn as nodeSpawn } from "node:child_process";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
  SDKMessage,
  SDKAssistantMessage,
  SDKResultMessage,
  SDKSystemMessage,
  Options,
  Query,
  SpawnOptions,
  SpawnedProcess,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentAdapter,
  AgentSession,
  AgentSessionContext,
  AgentEvent,
  TurnResult,
} from "../types.ts";
import { logger } from "../../../logging/logger.ts";

const DEFAULT_TURN_TIMEOUT_MS = 3_600_000;
const LOG_PROMPT_MAX_LENGTH = 1000;
const LOG_TEXT_MAX_LENGTH = 300;

export interface ClaudeCodeConfig {
  command?: string;
  outputFormat?: string;
  timeoutMs?: number;
  approvalPolicy?: string;
}

function extractTextFromContent(content: unknown[]): string | undefined {
  for (const block of content) {
    if (typeof block === "object" && block !== null && "type" in block) {
      const b = block as Record<string, unknown>;
      if (b.type === "text" && typeof b.text === "string") return b.text;
    }
  }
  return undefined;
}

function extractToolFromContent(content: unknown[]): {
  name?: string;
  input?: unknown;
} {
  for (const block of content) {
    if (typeof block === "object" && block !== null && "type" in block) {
      const b = block as Record<string, unknown>;
      if (b.type === "tool_use") {
        return {
          name: typeof b.name === "string" ? b.name : undefined,
          input: b.input,
        };
      }
    }
  }
  return {};
}

function extractUsageFromResult(msg: SDKResultMessage): TurnResult["usage"] {
  const u = msg.usage;
  const inputTokens = u.input_tokens ?? 0;
  const outputTokens = u.output_tokens ?? 0;
  if (inputTokens === 0 && outputTokens === 0) return undefined;
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
}

function mapSdkMessageToAgentEvent(msg: SDKMessage): AgentEvent | null {
  if (msg.type === "assistant") {
    const m = msg as SDKAssistantMessage;
    const content = Array.isArray(m.message?.content) ? m.message.content : [];
    return {
      event: "assistant",
      timestamp: new Date().toISOString(),
      message: extractTextFromContent(content),
      toolName: extractToolFromContent(content).name,
      toolInput: extractToolFromContent(content).input,
      sessionId: m.session_id,
      rawEvent: m as unknown as import("../types.ts").ClaudeStreamEvent,
    };
  }

  if (msg.type === "result") {
    const m = msg as SDKResultMessage;
    return {
      event: "result",
      timestamp: new Date().toISOString(),
      message: m.subtype === "success" ? m.result : undefined,
      usage: extractUsageFromResult(m),
      sessionId: m.session_id,
      rawEvent: m as unknown as import("../types.ts").ClaudeStreamEvent,
    };
  }

  if (msg.type === "system") {
    const m = msg as SDKSystemMessage;
    return {
      event: "system",
      timestamp: new Date().toISOString(),
      sessionId: m.session_id,
      rawEvent: m as unknown as import("../types.ts").ClaudeStreamEvent,
    };
  }

  // Generic fallback for other message types
  if ("session_id" in msg) {
    return {
      event: "system",
      timestamp: new Date().toISOString(),
      sessionId: (msg as { session_id: string }).session_id,
      rawEvent: msg as unknown as import("../types.ts").ClaudeStreamEvent,
    };
  }

  return null;
}

function extractTurnResult(msg: SDKResultMessage): TurnResult {
  if (msg.subtype === "success") {
    return {
      status: "completed",
      usage: extractUsageFromResult(msg),
    };
  }
  return {
    status: "failed",
    error:
      "errors" in msg && Array.isArray(msg.errors)
        ? msg.errors.join("; ")
        : `Turn failed: ${msg.subtype}`,
  };
}

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly kind = "claude-code";

  private readonly command: string | undefined;
  private readonly timeoutMs: number;
  private readonly approvalPolicy: string | undefined;
  private activeQuery: Query | null = null;

  constructor(config: ClaudeCodeConfig = {}) {
    this.command = config.command;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;
    this.approvalPolicy = config.approvalPolicy;
  }

  async startSession(ctx: AgentSessionContext): Promise<AgentSession> {
    logger.info(
      { sessionId: ctx.sessionId, workspace: ctx.workspacePath },
      "Starting Claude Code session",
    );
    return {
      id: ctx.sessionId,
      turnCount: 0,
      metadata: {
        workspacePath: ctx.workspacePath,
        issueIdentifier: ctx.issue.identifier,
        sessionId: ctx.sessionId,
        mcpServers: ctx.mcpServers,
      },
    };
  }

  async runTurn(
    session: AgentSession,
    prompt: string,
    onEvent: (event: AgentEvent) => void,
  ): Promise<TurnResult> {
    const sessionId =
      session.metadata.realSessionId ??
      session.metadata.sessionId;

    const abortController = new AbortController();
    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      abortController.abort();
      logger.warn(
        { sessionId: session.id, timeoutMs: this.timeoutMs },
        "Claude Code turn timed out",
      );
    }, this.timeoutMs);

    const options: Options = {
      cwd: session.metadata.workspacePath,
      abortController,
    };

    if (session.turnCount > 0 && sessionId) {
      options.resume = sessionId;
    }

    if (this.command && this.command !== "claude") {
      options.pathToClaudeCodeExecutable = this.command;
    }

    if (this.approvalPolicy === "auto") {
      options.permissionMode = "bypassPermissions";
      options.allowDangerouslySkipPermissions = true;
    }

    const mcpServers = session.metadata.mcpServers;
    if (mcpServers) {
      options.mcpServers = mcpServers;
      const allowedTools = [
        "Edit",
        "Write",
        "Read",
        "Bash",
        "Glob",
        "Grep",
        "LSP",
        "Agent",
        "NotebookEdit",
        "WebSearch",
      ];
      for (const serverName of Object.keys(mcpServers)) {
        allowedTools.push(`mcp__${serverName}__*`);
      }
      options.allowedTools = allowedTools;
    }

    const turn = session.turnCount + 1;
    logger.info(
      {
        sessionId: session.id,
        turn,
        prompt:
          prompt.length > LOG_PROMPT_MAX_LENGTH
            ? prompt.slice(0, LOG_PROMPT_MAX_LENGTH) + "...[truncated]"
            : prompt,
        resume: session.turnCount > 0 && sessionId ? sessionId : undefined,
      },
      "Turn started",
    );

    const q = query({ prompt, options });
    this.activeQuery = q;

    try {
      for await (const msg of q) {
        logger.debug(
          { sessionId: msg.session_id, turn, msgType: (msg as any).type, msg },
          "SDK message",
        );

        if ("session_id" in msg && !session.metadata.realSessionId) {
          session.metadata.realSessionId = (
            msg as { session_id: string }
          ).session_id;
        }

        const event = mapSdkMessageToAgentEvent(msg);
        if (event) onEvent(event);

        if (msg.type === "assistant") {
          const m = msg as SDKAssistantMessage;
          const content = Array.isArray(m.message?.content)
            ? m.message.content
            : [];
          const text = extractTextFromContent(content);
          if (text) {
            logger.info(
              {
                sessionId: msg.session_id,
                turn,
                text:
                  text.length > LOG_TEXT_MAX_LENGTH
                    ? text.slice(0, LOG_TEXT_MAX_LENGTH) + "...[truncated]"
                    : text,
              },
              "Assistant text",
            );
          }
        }

        if (msg.type === "result") {
          clearTimeout(timeoutHandle);
          session.turnCount++;
          const r = msg as SDKResultMessage;
          const usage = extractUsageFromResult(r);
          logger.info(
            {
              sessionId: session.id,
              turn,
              status: r.subtype,
              inputTokens: usage?.inputTokens,
              outputTokens: usage?.outputTokens,
              totalTokens: usage?.totalTokens,
            },
            "Turn completed",
          );
          return extractTurnResult(r);
        }
      }
    } catch (err) {
      clearTimeout(timeoutHandle);
      if (timedOut) {
        logger.warn(
          { sessionId: session.id, turn, timeoutMs: this.timeoutMs },
          "Turn timed out",
        );
        return {
          status: "timed_out",
          error: `Turn timed out after ${this.timeoutMs}ms`,
        };
      }
      logger.error(
        { sessionId: session.id, turn, error: String(err) },
        "Turn failed with SDK error",
      );
      return { status: "failed", error: `SDK query error: ${err}` };
    } finally {
      this.activeQuery = null;
      clearTimeout(timeoutHandle);
    }

    session.turnCount++;
    return { status: "completed" };
  }

  async stopSession(_session: AgentSession): Promise<void> {
    if (this.activeQuery) {
      this.activeQuery.close();
      this.activeQuery = null;
    }
  }
}

export function createClaudeCodeAdapter(
  rawConfig: Record<string, unknown>,
): AgentAdapter {
  return new ClaudeCodeAdapter({
    command: rawConfig.command as string | undefined,
    outputFormat: rawConfig.output_format as string | undefined,
    timeoutMs: rawConfig.timeout_ms as number | undefined,
    approvalPolicy: rawConfig.approval_policy as string | undefined,
  });
}
