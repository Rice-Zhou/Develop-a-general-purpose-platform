import { Agent, ProxyAgent, fetch, type RequestInit } from "undici";
import { AppError } from "../../../contracts/src/error";
import { AIProxyUrlSchema } from "../../../contracts/src/analysis";

const directAgent = new Agent();
const proxyVariable =
  /^(?:https?_proxy|all_proxy|no_proxy|node_use_env_proxy)$/i;

export function directEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const result = Object.fromEntries(
    Object.entries(env).filter(([key]) => !proxyVariable.test(key)),
  );
  return { ...result, NO_PROXY: "*", NODE_USE_ENV_PROXY: "0" };
}
export function gitEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const result = directEnvironment(env);
  delete result.GIT_SSH;
  // OpenSSH still reads identity/host configuration; per-command options disable
  // proxying and override ProxyCommand/ProxyJump from that configuration.
  return {
    ...result,
    GIT_SSH_COMMAND: "ssh -o ProxyCommand=none -o ProxyJump=none",
    GIT_SSH_VARIANT: "ssh",
  };
}

function validatedProxy(proxyUrl: string): string {
  const parsed = AIProxyUrlSchema.safeParse(proxyUrl);
  if (!parsed.success)
    throw new AppError(
      "MODEL_PROXY_INVALID",
      "代理必须为不含账号、密码、查询参数的 HTTP(S) 地址",
    );
  return parsed.data;
}

export function aiEnvironment(
  proxyUrl?: string,
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const result = directEnvironment(env);
  if (!proxyUrl) return result;
  const proxy = validatedProxy(proxyUrl);
  delete result.NO_PROXY;
  return {
    ...result,
    HTTP_PROXY: proxy,
    HTTPS_PROXY: proxy,
    ALL_PROXY: proxy,
    http_proxy: proxy,
    https_proxy: proxy,
    all_proxy: proxy,
    NODE_USE_ENV_PROXY: "1",
  };
}

export function fetchDirect(input: string | URL, init?: RequestInit) {
  return fetch(input, { ...init, dispatcher: directAgent });
}

export async function fetchWithProxy(
  input: string | URL,
  init: RequestInit,
  proxyUrl?: string,
) {
  if (!proxyUrl) return fetchDirect(input, init);
  const dispatcher = new ProxyAgent(validatedProxy(proxyUrl));
  try {
    return await fetch(input, { ...init, dispatcher });
  } finally {
    // Graceful close waits for the response body, including cancellation by the caller.
    void dispatcher.close();
  }
}
