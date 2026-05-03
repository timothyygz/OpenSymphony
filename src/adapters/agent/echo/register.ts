import { registerAgent } from "../registry.ts";
import { createEchoAdapter } from "./adapter.ts";

registerAgent("echo", createEchoAdapter);
