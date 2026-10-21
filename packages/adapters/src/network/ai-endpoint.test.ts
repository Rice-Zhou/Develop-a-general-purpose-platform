import { expect, it, vi } from "vitest";
import { resolveAIEndpoint } from "./ai-endpoint";
it.each([200, 401, 403, 405, 429, 500])("HTTPS HTTP %s is reachable without credentials or materials", async status => {
  const probe = vi.fn(async () => new Response(null, { status }));
  const selected = await resolveAIEndpoint("host/v1", "api", { probe });
  expect(selected.scheme).toBe("https");
  expect(probe).toHaveBeenCalledOnce();
  const [, init] = probe.mock.calls[0] as unknown as [string, RequestInit];
  expect(init.method).toBe("HEAD"); expect(init.body).toBeUndefined(); expect(init.headers).toBeUndefined();
});
it("falls back only after transport failure and records a sanitized diagnostic", async () => {
  const probe = vi.fn().mockRejectedValueOnce(new Error("secret https failure")).mockResolvedValueOnce(new Response());
  expect(await resolveAIEndpoint("host:123", "proxy", { probe })).toEqual({url:"http://host:123",scheme:"http",httpsFailure:"CONNECTION_FAILED"});
  expect(probe).toHaveBeenCalledTimes(2);
});
it("reports both failed candidates and does not continue after cancellation", async () => {
  const probe = vi.fn().mockRejectedValue(new Error("sensitive body"));
  await expect(resolveAIEndpoint("host", "api", {probe})).rejects.toThrow(/HTTPS.*HTTP/);
  const controller = new AbortController(); controller.abort(); probe.mockClear();
  await expect(resolveAIEndpoint("host", "api", {probe, signal:controller.signal})).rejects.toThrow();
  expect(probe).not.toHaveBeenCalled();
});
