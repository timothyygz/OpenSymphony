import { registerAgent } from "../registry.ts";
import { createClaudeCodeAdapter } from "./adapter.ts";

registerAgent("claude-code", createClaudeCodeAdapter);
