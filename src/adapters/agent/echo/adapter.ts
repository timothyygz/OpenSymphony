import type { AgentAdapter, AgentSession, AgentSessionContext, AgentEvent, TurnResult } from "../types.ts";
import { logger } from "../../../logging/logger.ts";

export class EchoAdapter implements AgentAdapter {
  readonly kind = "echo";

  async startSession(ctx: AgentSessionContext): Promise<AgentSession> {
    logger.info({ sessionId: ctx.sessionId, workspace: ctx.workspacePath }, "Starting echo session");
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
    const now = new Date().toISOString();

    onEvent({
      event: "message",
      timestamp: now,
      message: `[echo] ${prompt.substring(0, 200)}`,
    });

    onEvent({
      event: "completed",
      timestamp: new Date().toISOString(),
    });

    session.turnCount++;
    return { status: "completed" };
  }

  async stopSession(): Promise<void> {}
}

export function createEchoAdapter(_config: Record<string, unknown>): AgentAdapter {
  return new EchoAdapter();
}
