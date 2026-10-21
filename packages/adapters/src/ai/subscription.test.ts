import { expect, it } from "vitest";
import { SubscriptionTransport } from "./subscription";
it("disables automatic skill and AGENTS instructions without changing the account home or read-only boundary", async () => {
  const calls: { args: string[]; env?: NodeJS.ProcessEnv }[] = [];
  const transport = new SubscriptionTransport({ kind: "codex", id: "c", name: "Codex", model: "gpt-6.1-sol", executable: "D:/tools/codex.exe", credentialRef: null, outboundEnabled: true }, process.cwd(), async (_exe, args, options) => {
    calls.push({ args, env: options.env });
    return JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: '{"result":1}' } });
  });
  expect(await transport.complete([], [], new AbortController().signal)).toEqual({ content: "1" });
  const { args, env } = calls[0];
  for (const config of ["project_doc_max_bytes=0", "skills.include_instructions=false", "skills.bundled.enabled=false"])
    expect(args.some((arg, index) => arg === "-c" && args[index + 1] === config)).toBe(true);
  expect(args).toContain("read-only");
  expect(args).toContain("--ignore-user-config");
  expect(args).toContain("--ignore-rules");
  expect(args).toContain("skill_search");
  expect(env?.CODEX_HOME).toBe(process.env.CODEX_HOME);
});
it("preserves sanitized structured Codex failures instead of replacing them with login advice", async () => {
  const transport = new SubscriptionTransport({ kind: "codex", id: "c", name: "Codex", model: "gpt-6.1-sol", executable: "D:/tools/codex.exe", credentialRef: null, outboundEnabled: true }, process.cwd(), async () => JSON.stringify({ type: "turn.failed", error: { message: "Model gpt-6.1-sol not supported token=secret-token https://example.test/private" } }));
  const error = await transport.complete([], [], new AbortController().signal).catch((error: Error) => error);
  expect(error).toMatchObject({ code: "SUBSCRIPTION_FAILED" });
  expect((error as Error).message).toContain("Model gpt-6.1-sol not supported");
  expect((error as Error).message).not.toContain("secret-token");
  expect((error as Error).message).not.toContain("example.test");
});
