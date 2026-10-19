import { isAbsolute } from "node:path";
import { z } from "zod";
import type { AIProfile } from "../../../contracts/src/analysis";
import { AppError } from "../../../contracts/src/error";
import type {
  ModelTransport,
  ModelMessage,
  ModelReply,
  ToolSpec,
} from "../../../core/src/analysis/ports";
import { runProcess } from "../process/run-process";
import { executorIdentity } from "./identity";
import { aiEnvironment } from "../network/policy";
const envelope = z
  .object({
    calls: z
      .array(
        z.object({
          name: z.string(),
          arguments: z.record(z.string(), z.unknown()),
        }),
      )
      .optional(),
    result: z.unknown().optional(),
  })
  .strict();
const disabled = [
  "shell_tool",
  "unified_exec",
  "apps",
  "plugins",
  "hooks",
  "browser_use",
  "browser_use_external",
  "computer_use",
  "image_generation",
  "view_image",
  "multi_agent",
  "multi_agent_v2",
  "code_mode",
  "code_mode_host",
  "skill_search",
  "tool_suggest",
  "workspace_dependencies",
  "memories",
];
export class SubscriptionTransport implements ModelTransport {
  readonly version = "subscription-input-only-1";
  readonly identity;
  constructor(
    private readonly profile: AIProfile & { kind: "codex" | "claude" },
    private readonly cwd: string,
    private readonly run: typeof runProcess = runProcess,
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
        "请允许通过所选订阅工具发送项目材料",
      );
    if (
      !isAbsolute(this.profile.executable) ||
      !/\.exe$/i.test(this.profile.executable)
    )
      throw new AppError(
        "CLI_PATH_INVALID",
        "请选择工具的实际 exe，不能使用 Shell 或命令模板",
      );
    const input = JSON.stringify({
      instruction:
        '仅根据这些消息和材料回答。不要读取文件、执行命令或使用本机工具。需要材料时返回 {"calls":[{"name":"工具名","arguments":{}}]}；最终回答返回 {"result":结果对象}。仅输出 JSON，不使用 Markdown 围栏。',
      tools,
      messages,
    });
    if (input.length > 700000)
      throw new AppError("MODEL_INPUT_LIMIT", "订阅工具输入超过预算");
    const args =
      this.profile.kind === "codex"
        ? [
            "exec",
            "--sandbox",
            "read-only",
            "--ignore-user-config",
            "--ignore-rules",
            "--ephemeral",
            "--skip-git-repo-check",
            "--json",
            "--color",
            "never",
            ...disabled.flatMap((feature) => ["--disable", feature]),
            ...(this.profile.model ? ["--model", this.profile.model] : []),
            "-",
          ]
        : [
            "-p",
            "--output-format",
            "json",
            "--tools",
            "",
            "--permission-mode",
            "dontAsk",
            "--no-session-persistence",
            "--strict-mcp-config",
            "--mcp-config",
            '{"mcpServers":{}}',
            "--setting-sources",
            "",
            "--settings",
            '{"disableAllHooks":true}',
            ...(this.profile.model ? ["--model", this.profile.model] : []),
          ];
    const env = aiEnvironment(this.profile.proxyUrl);
    delete env.OPENAI_API_KEY;
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
    delete env.OPENAI_BASE_URL;
    delete env.ANTHROPIC_BASE_URL;
    this.assertCurrent?.();
    const output = await this.run(this.profile.executable, args, {
      cwd: this.cwd,
      input,
      signal,
      timeoutMs: 20 * 60 * 1000,
      maxOutput: 8 * 1024 * 1024,
      env,
    });
    let text: string | undefined;
    if (this.profile.kind === "codex") {
      for (const line of output.split(/\r?\n/).filter(Boolean)) {
        const value = JSON.parse(line) as {
          type: string;
          item?: { type: string; text?: string };
        };
        if (value.type === "error" || value.type === "turn.failed")
          throw new AppError(
            "SUBSCRIPTION_FAILED",
            "Codex 订阅工具执行失败，请检查登录与额度",
          );
        if (
          value.item &&
          [
            "command_execution",
            "file_change",
            "mcp_tool_call",
            "web_search",
            "tool_call",
          ].includes(value.item.type)
        )
          throw new AppError(
            "CLI_READ_ONLY_VIOLATION",
            "订阅工具调用了未授权工具，结果未接纳",
          );
        if (
          value.type === "item.completed" &&
          value.item?.type === "agent_message"
        )
          text = value.item.text;
      }
    } else {
      const response = z
        .object({ result: z.string(), is_error: z.boolean().optional() })
        .parse(JSON.parse(output));
      if (response.is_error)
        throw new AppError(
          "SUBSCRIPTION_FAILED",
          "Claude Code 执行失败，请检查工具登录与额度",
        );
      text = response.result;
    }
    if (!text)
      throw new AppError(
        "MODEL_OUTPUT_INVALID",
        "订阅工具没有返回结构化最终消息",
      );
    const parsed = envelope.safeParse(JSON.parse(text));
    if (!parsed.success)
      throw new AppError(
        "MODEL_OUTPUT_INVALID",
        "订阅工具输出不符合平台执行协议",
      );
    if (parsed.data.calls?.length)
      return {
        content: null,
        toolCalls: parsed.data.calls.map((call, index) => ({
          id: `cli-${index}`,
          name: call.name,
          arguments: JSON.stringify(call.arguments),
        })),
      };
    if (parsed.data.result === undefined)
      throw new AppError("MODEL_OUTPUT_INVALID", "订阅工具没有返回结果");
    return { content: JSON.stringify(parsed.data.result) };
  }
}
