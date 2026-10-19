import type { ExecutorIdentity } from "../../../contracts/src/analysis";
export interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: unknown[];
}
export interface ToolSpec {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}
export interface ModelReply {
  content: string | null;
  toolCalls?: { id: string; name: string; arguments: string }[];
  usage?: { inputTokens: number; outputTokens: number };
}
export interface ModelTransport {
  identity: ExecutorIdentity;
  complete(
    messages: ModelMessage[],
    tools: ToolSpec[],
    signal: AbortSignal,
  ): Promise<ModelReply>;
  version: string;
}
