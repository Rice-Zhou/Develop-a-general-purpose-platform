import { parseAIAddress, type AIAddressKind } from "../../../contracts/src/ai-address";
import { AppError } from "../../../contracts/src/error";
import { fetchWithProxy } from "./policy";
export interface EndpointSelection { url: string; scheme: "https" | "http"; httpsFailure?: string }
type Probe = (url: string, init: { method: "HEAD"; redirect: "manual"; signal: AbortSignal }, proxyUrl?: string) => Promise<{ body: { cancel(): Promise<void> } | null }>;
export async function resolveAIEndpoint(address: string, kind: AIAddressKind, options: {
  proxyUrl?: string; signal?: AbortSignal; probe?: Probe;
} = {}): Promise<EndpointSelection> {
  const candidates = parseAIAddress(address, kind);
  const probe: Probe = options.probe ?? ((url, init, proxyUrl) => fetchWithProxy(url, init, proxyUrl));
  let httpsFailure: string | undefined;
  for (const scheme of ["https", "http"] as const) {
    options.signal?.throwIfAborted();
    const url = scheme === "https" ? candidates.httpsUrl : candidates.httpUrl;
    try {
      // No key or project material is sent. Every HTTP status proves protocol reachability.
      const result = await probe(url, { method: "HEAD", redirect: "manual", signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000) }, options.proxyUrl);
      await result.body?.cancel();
      return { url, scheme, ...(httpsFailure ? { httpsFailure } : {}) };
    } catch {
      options.signal?.throwIfAborted();
      if (scheme === "https") httpsFailure = "CONNECTION_FAILED";
      else throw new AppError("AI_ENDPOINT_UNREACHABLE", "HTTPS 探测失败；HTTP 探测也失败，请检查地址、代理或网络（未发送模型请求）");
    }
  }
  throw new AppError("AI_ENDPOINT_UNREACHABLE", "无法选择 AI 协议");
}
