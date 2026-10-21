import { AppError } from "./error";
export type AIAddressKind = "api" | "proxy";
export function parseAIAddress(input: string, kind: AIAddressKind) {
  const address = input.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (!address || address.length > 2048 || /[\s\\?#@]/.test(address) || address.includes("://"))
    throw new AppError("AI_ADDRESS_INVALID", "请输入不含凭据、空白、查询参数或片段的服务地址");
  let url: URL;
  try { url = new URL(`https://${address}`); }
  catch { throw new AppError("AI_ADDRESS_INVALID", "AI 地址无效，请检查主机和端口"); }
  if (!url.hostname || url.username || url.password || (kind === "proxy" && url.pathname !== "/"))
    throw new AppError("AI_ADDRESS_INVALID", "代理仅接受主机与端口，不能包含业务路径或凭据");
  const normalized = `${url.host}${url.pathname.replace(/\/+$/, "")}`;
  return { address: normalized, httpsUrl: `https://${normalized}`, httpUrl: `http://${normalized}` };
}
