import type {
  AgentAdapter,
  AgentSession,
  AgentSessionContext,
  AgentEvent,
  TurnResult,
} from "../types.ts";

export class EchoAdapter implements AgentAdapter {
  readonly kind = "echo";

  async startSession(ctx: AgentSessionContext): Promise<AgentSession> {
    return {
      id: ctx.sessionId,
      turnCount: 0,
      metadata: { workspacePath: ctx.workspacePath },
    };
  }

  async runTurn(
    session: AgentSession,
    prompt: string,
    onEvent: (event: AgentEvent) => void,
  ): Promise<TurnResult> {
    session.turnCount++;
    onEvent({
      event: "assistant",
      timestamp: new Date().toISOString(),
      message: prompt,
    });
    return { status: "completed" };
  }

  async stopSession(): Promise<void> {}
}

export function createEchoAdapter(
  _config: Record<string, unknown>,
): AgentAdapter {
  return new EchoAdapter();
}
