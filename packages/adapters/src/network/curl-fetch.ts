import { join } from "node:path";
import { AppError } from "../../../contracts/src/error";
import { runProcess } from "../process/run-process";
import { instanceUrl } from "../../../core/src/issues/scope-policy";

// Use Windows' certificate-verified TLS stack for the Trinity deployment.
// Neither credentials nor request bodies appear in command-line arguments.
export async function curlFetch(
  input: string | URL,
  init: RequestInit = {},
  run: typeof runProcess = runProcess,
): Promise<Response> {
  const url = new URL(input);
  instanceUrl(url.origin);
  if (url.username || url.password || url.hash)
    throw new AppError("ISSUE_URL_INVALID", "请求地址不能包含凭据或片段");
  const method = init.method ?? "GET";
  if (
    !["GET", "POST"].includes(method) ||
    (init.body != null && typeof init.body !== "string")
  )
    throw new AppError("ISSUE_REQUEST_INVALID", "不支持的请求类型");
  const config = [
    `url = ${JSON.stringify(url.href)}`,
    `request = ${JSON.stringify(method)}`,
  ];
  new Headers(init.headers).forEach((value, name) =>
    config.push(`header = ${JSON.stringify(`${name}: ${value}`)}`),
  );
  if (init.body != null)
    config.push(`data-binary = ${JSON.stringify(init.body)}`);
  const output = await run(
    join(process.env.SystemRoot || "C:/Windows", "System32", "curl.exe"),
    [
      "--disable",
      "--silent",
      "--show-error",
      "--fail",
      "--max-time",
      "30",
      "--noproxy",
      "*",
      "--proxy",
      "",
      "--config",
      "-",
      "--write-out",
      "\n%{http_code}",
    ],
    {
      cwd: process.cwd(),
      input: config.join("\n"),
      signal: init.signal ?? undefined,
      maxOutput: 8 * 1024 * 1024,
      timeoutMs: 31000,
    },
  );
  const newline = output.lastIndexOf("\n");
  const status = Number(output.slice(newline + 1));
  if (newline < 0 || !Number.isInteger(status) || status < 200 || status >= 300)
    throw new AppError(
      "ISSUE_REMOTE_FAILED",
      "平台请求失败或返回重定向，未输出响应正文",
    );
  return new Response(output.slice(0, newline), { status });
}
