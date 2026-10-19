import { expect, it } from "vitest";
import { createServer } from "node:http";
import { once } from "node:events";
import { ChatCompletionsTransport } from "./chat-completions";
import { SubscriptionTransport } from "./subscription";
it("calls only the configured model endpoint and parses tool calls without leaking a key on failure", async () => {
  const bodies: unknown[] = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const part of req) body += part;
    bodies.push(JSON.parse(body));
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call",
                  type: "function",
                  function: { name: "readCode", arguments: "{}" },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 2, completion_tokens: 1 },
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as { port: number };
  try {
    const api = new ChatCompletionsTransport(
      {
        name: "test",
        kind: "api",
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        model: "configured-model",
        outboundEnabled: true,
        id: "a",
        credentialRef: null,
      },
      async () => null,
    );
    expect(api.identity.configuredModel).toBe("configured-model");
    expect(api.identity.location).toContain(`127.0.0.1:${address.port}`);
    const reply = await api.complete(
      [{ role: "user", content: "probe" }],
      [],
      new AbortController().signal,
    );
    expect(reply.toolCalls?.[0].name).toBe("readCode");
    expect(bodies[0]).toMatchObject({ model: "configured-model" });
  } finally {
    server.close();
    await once(server, "close");
  }
});
it("subscription adapters use fixed read-only/no-tool flags and parse only structured final replies", async () => {
  const calls: { args: string[]; input?: string }[] = [];
  const run = async (
    _exe: string,
    args: string[],
    options: { input?: string },
  ) => {
    calls.push({ args, input: options.input });
    return (
      JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text: '{"result":{"items":[]}}' },
      }) + "\n"
    );
  };
  const transport = new SubscriptionTransport(
    {
      kind: "codex",
      id: "c",
      name: "ChatGPT",
      model: "",
      executable: "D:/tools/codex.exe",
      credentialRef: null,
      outboundEnabled: true,
    },
    process.cwd(),
    run,
  );
  const response = await transport.complete(
    [{ role: "user", content: "materials" }],
    [],
    new AbortController().signal,
  );
  expect(response.content).toBe('{"items":[]}');
  expect(calls[0].args).toContain("read-only");
  expect(calls[0].args).toContain("--ignore-user-config");
  expect(calls[0].args).not.toContain("materials");
  expect(calls[0].input).toContain("materials");
});
