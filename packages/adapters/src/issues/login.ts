import { createCipheriv } from "node:crypto";
import { z } from "zod";
import { AppError } from "../../../contracts/src/error";
import { trinityApiUrl } from "../../../core/src/issues/scope-policy";
import { readResponseText } from "../network/response";
import { curlFetch } from "../network/curl-fetch";

// Read public protocol parameters from the chosen site's frontend; never execute it
// or ship a hardcoded encryption key. Unsupported versions fail before sending a password.
export async function loginTrinity(
  baseUrl: string,
  username: string,
  password: string,
  request: (
    url: string | URL,
    init?: RequestInit,
  ) => Promise<Response> = curlFetch,
): Promise<string> {
  const base = trinityApiUrl(baseUrl);
  const origin = new URL(base).origin;
  const signal = AbortSignal.timeout(30000);
  let budget = 8 * 1024 * 1024;
  const read = async (url: string) => {
    const response = await request(url, { redirect: "error", signal });
    if (!response.ok)
      throw new AppError(
        "TRINITY_LOGIN_UNSUPPORTED",
        "无法读取所选站点的登录协议",
      );
    const reader = response.body?.getReader();
    if (!reader)
      throw new AppError("TRINITY_LOGIN_UNSUPPORTED", "登录协议内容为空");
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        budget -= value.length;
        if (budget < 0)
          throw new AppError(
            "TRINITY_LOGIN_UNSUPPORTED",
            "登录协议超出读取预算",
          );
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    return Buffer.concat(chunks).toString("utf8");
  };
  const html = await read(origin + "/");
  const scripts = [
    ...html.matchAll(/<script\b[^>]*\bsrc=["']?([^\s"'>]+)[^>]*>/gi),
  ]
    .map((match) => new URL(match[1], origin + "/"))
    .filter(
      (url) =>
        url.origin === origin &&
        /\/app(?:[~.-]|\.js)/.test(url.pathname) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash,
    );
  if (scripts.length > 20)
    throw new AppError("TRINITY_LOGIN_UNSUPPORTED", "登录前端脚本超过预算");
  let parameters: RegExpMatchArray | null = null;
  for (const script of scripts) {
    const source = await read(script.href);
    parameters = source.match(
      /\.enc\.Utf8\.parse\(["']([^"']+)["']\)[\s\S]{0,100}?\.enc\.Utf8\.parse\(["']([^"']+)["']\)[\s\S]{0,200}?AES\.encrypt/,
    );
    if (parameters) break;
  }
  if (
    !parameters ||
    Buffer.byteLength(parameters[1]) !== 16 ||
    Buffer.byteLength(parameters[2]) !== 16
  )
    throw new AppError(
      "TRINITY_LOGIN_UNSUPPORTED",
      "所选 Trinity 登录协议尚不支持，未发送账号密码",
    );
  const cipher = createCipheriv(
    "aes-128-cbc",
    Buffer.from(parameters[1]),
    Buffer.from(parameters[2]),
  );
  const encrypted = Buffer.concat([
    cipher.update(password, "utf8"),
    cipher.final(),
  ]).toString("base64");
  const response = await request(base + "/security/login/ldap", {
    method: "POST",
    redirect: "error",
    signal,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Platform": "trinity",
    },
    body: new URLSearchParams({
      uid: username,
      pwd: encodeURIComponent(encrypted),
    }).toString(),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new AppError(
      "ISSUE_LOGIN_FAILED",
      `Trinity 登录失败（HTTP ${response.status}）`,
    );
  }
  const text = await readResponseText(response);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new AppError(
      "ISSUE_LOGIN_FAILED",
      "Trinity 登录响应格式无效，未保存正文",
    );
  }
  const result = z
    .object({
      code: z.literal(200),
      data: z.object({ token: z.string().min(1).max(16000) }),
    })
    .safeParse(raw);
  if (!result.success)
    throw new AppError(
      "ISSUE_LOGIN_FAILED",
      "Trinity 登录未成功，请检查账号、密码及验证码要求；未保存响应正文",
    );
  return result.data.data.token;
}

export async function readTrinityIdentity(baseUrl: string, token: string, request: typeof fetch = curlFetch as typeof fetch): Promise<{ accountId: string }> {
 const response = await request(trinityApiUrl(baseUrl) + "/sys/user/userinfo", {redirect:"error",signal:AbortSignal.timeout(30000),headers:{"X-Token":`Bearer ${token.replace(/^Bearer\s+/i, "")}`,"X-Platform":"trinity",Accept:"application/json"}});
 if (!response.ok) { await response.body?.cancel(); throw new AppError("ISSUE_LOGIN_FAILED", `Trinity 账号验证失败（HTTP ${response.status}）`); }
 const text = await readResponseText(response);
 let raw:unknown; try {raw=JSON.parse(text);} catch {throw new AppError("ISSUE_LOGIN_FAILED","Trinity 身份响应不是有效 JSON，未保存正文");}
 const result=z.object({code:z.literal(200),data:z.object({uid:z.union([z.string().min(1),z.number()]).transform(String),apiVersion:z.string().min(1),isGray:z.boolean()})}).safeParse(raw);
 if (!result.success) throw new AppError("TRINITY_IDENTITY_REQUIRED","Trinity 未返回可验证的账号 UID，未保存连接");
 return {accountId:result.data.data.uid};
}
