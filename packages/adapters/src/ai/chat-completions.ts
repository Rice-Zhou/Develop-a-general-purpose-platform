import { z } from "zod";
import type { AIProfile } from "../../../contracts/src/analysis";
import { AppError } from "../../../contracts/src/error";
import { executorIdentity } from "./identity";
import type {
  ModelTransport,
  ModelMessage,
  ModelReply,
  ToolSpec,
} from "../../../core/src/analysis/ports";
const response = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable().optional(),
          tool_calls: z
            .array(
              z.object({
                id: z.string(),
                type: z.literal("function"),
                function: z.object({ name: z.string(), arguments: z.string() }),
              }),
            )
            .optional(),
        }),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().nonnegative(),
      completion_tokens: z.number().nonnegative(),
    })
    .optional(),
});
export class ChatCompletionsTransport implements ModelTransport {
  readonly version = "chat-completions-1";
  readonly identity;
  constructor(
    private readonly profile: AIProfile & { kind: "api" },
    private readonly resolveKey: () => Promise<string | null>,
    private readonly assertCurrent?: () => void,
  ) {
    this.identity = executorIdentity(profile);
  }
  async complete(
    messages: ModelMessage[],
    tools: ToolSpec[],
    signal: AbortSignal,
  ): Promise<ModelReply> {
    if (!this.profile.outboundEnabled)
      throw new AppError(
        "OUTBOUND_NOT_APPROVED",
        "请在模型设置允许向此连接发送项目材料",
      );
    const url = new URL(this.profile.baseUrl);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !(
        url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
      )
    )
      throw new AppError(
        "MODEL_URL_INVALID",
        "模型地址必须为 HTTPS，或明确配置的本机 HTTP 地址",
      );
    url.pathname = url.pathname.replace(/\/$/, "") + "/chat/completions";
    const key = await this.resolveKey();
    if (!key && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
      throw new AppError(
        "MODEL_KEY_MISSING",
        "请在应用设置提供此模型连接的密钥",
      );
    const body = JSON.stringify({
      model: this.profile.model,
      messages,
      stream: false,
      response_format: { type: "json_object" },
      ...(tools.length ? { tools, tool_choice: "auto" } : {}),
    });
    if (body.length > 700000)
      throw new AppError("MODEL_INPUT_LIMIT", "模型请求超过 700,000 字符预算");
    let result: Response;
    this.assertCurrent?.();
    try {
      result = await fetch(url, {
        method: "POST",
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
        },
        body,
        signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
      });
    } catch {
      if (signal.aborted) throw new AppError("CANCELLED", "模型请求已取消");
      throw new AppError(
        "MODEL_NETWORK_FAILED",
        "模型连接失败或超时，请检查地址、代理和服务状态",
      );
    }
    if (!result.ok) {
      await result.body?.cancel();
      throw new AppError(
        result.status === 401 || result.status === 403
          ? "MODEL_AUTH_FAILED"
          : result.status === 429
            ? "MODEL_RATE_LIMIT"
            : "MODEL_HTTP_FAILED",
        `模型服务返回 HTTP ${result.status}，未保存原始错误正文`,
      );
    }
    const reader = result.body?.getReader();
    if (!reader) throw new AppError("MODEL_OUTPUT_INVALID", "模型响应没有正文");
    let size = 0;
    const buffers: Uint8Array[] = [];
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 8 * 1024 * 1024)
          throw new AppError("MODEL_OUTPUT_LIMIT", "模型响应超过 8 MiB");
        buffers.push(part.value);
      }
    } finally {
      await reader.cancel();
    }
    let raw: unknown;
    try {
      raw = JSON.parse(Buffer.concat(buffers).toString("utf8"));
    } catch {
      throw new AppError("MODEL_OUTPUT_INVALID", "模型接口没有返回合法 JSON");
    }
    const parsed = response.safeParse(raw);
    if (!parsed.success)
      throw new AppError(
        "MODEL_OUTPUT_INVALID",
        "模型响应不符合 chat-completions 协议",
      );
    const item = parsed.data.choices[0].message;
    return {
      content: item.content ?? null,
      toolCalls: item.tool_calls?.map((call) => ({
        id: call.id,
        name: call.function.name,
        arguments: call.function.arguments,
      })),
      ...(parsed.data.usage
        ? {
            usage: {
              inputTokens: parsed.data.usage.prompt_tokens,
              outputTokens: parsed.data.usage.completion_tokens,
            },
          }
        : {}),
    };
  }
}
