import type { AgentAdapter, AgentSession, AgentSessionContext, AgentEvent, TurnResult } from "../types.ts";
import { runClaudeProcess } from "./process.ts";
import { logger } from "../../../logging/logger.ts";

export interface ClaudeCodeConfig {
  command?: string;
  outputFormat?: string;
  timeoutMs?: number;
  approvalPolicy?: string;
}

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly kind = "claude-code";

  private readonly command: string;
  private readonly outputFormat: string;
  private readonly timeoutMs: number;
  private readonly approvalPolicy: string | undefined;

  constructor(config: ClaudeCodeConfig = {}) {
    this.command = config.command ?? "claude";
    this.outputFormat = config.outputFormat ?? "stream-json";
    this.timeoutMs = config.timeoutMs ?? 3600000;
    this.approvalPolicy = config.approvalPolicy;
  }

  async startSession(ctx: AgentSessionContext): Promise<AgentSession> {
    logger.info({ sessionId: ctx.sessionId, workspace: ctx.workspacePath }, "Starting Claude Code session");
    return {
      id: ctx.sessionId,
      turnCount: 0,
      metadata: {
        workspacePath: ctx.workspacePath,
        issueIdentifier: ctx.issue.identifier,
      },
    };
  }

  async runTurn(session: AgentSession, prompt: string, onEvent: (event: AgentEvent) => void): Promise<TurnResult> {
    const isFirstTurn = session.turnCount === 0;
    const args = isFirstTurn
      ? ["-p", prompt]
      : ["--continue", "-p", prompt];

    args.push("--output-format", this.outputFormat, "--verbose");

    if (this.approvalPolicy === "auto") {
      args.push("--dangerously-skip-permissions");
    }

    const workspacePath = session.metadata.workspacePath as string;

    logger.info({
      sessionId: session.id,
      turn: session.turnCount + 1,
      isFirstTurn,
      command: this.command,
    }, "Running Claude Code turn");

    const result = await runClaudeProcess({
      command: this.command,
      args,
      cwd: workspacePath,
      timeoutMs: this.timeoutMs,
      onEvent: (event) => {
        // Track session ID from Claude Code output if available
        onEvent(event);
      },
    });

    session.turnCount++;
    return result;
  }

  async stopSession(_session: AgentSession): Promise<void> {
    // Each turn is a separate process, nothing to stop
  }
}

export function createClaudeCodeAdapter(rawConfig: Record<string, unknown>): AgentAdapter {
  return new ClaudeCodeAdapter({
    command: rawConfig.command as string | undefined,
    outputFormat: rawConfig.output_format as string | undefined,
    timeoutMs: rawConfig.timeout_ms as number | undefined,
    approvalPolicy: rawConfig.approval_policy as string | undefined,
  });
}
