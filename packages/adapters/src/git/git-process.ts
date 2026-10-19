import { spawn } from "node:child_process";
import { devNull } from "node:os";
import { AppError } from "../../../contracts/src/error";
import { terminateProcessTree } from "./process-tree";
import { gitEnvironment } from "../network/policy";
const MAX_OUTPUT = 32 * 1024 * 1024;
export async function runGit(
  cwd: string,
  args: string[],
  signal?: AbortSignal,
  allowed = [0],
  options: { input?: Buffer; terminate?: typeof terminateProcessTree } = {},
): Promise<{ stdout: Buffer; code: number }> {
  // Command-scoped overrides also cover remote-specific and URL-specific Git proxies.
  // Reading effective keys preserves user configuration and included config files.
  const configured = await executeGit(
    cwd,
    [
      "config",
      "--name-only",
      "--get-regexp",
      "^(http(\\..*)?\\.proxy|remote\\..*\\.proxy)$",
    ],
    signal,
    [0, 1],
    { terminate: options.terminate },
  );
  const proxyKeys = new Set([
    "http.proxy",
    ...configured.stdout.toString("utf8").split(/\r?\n/).filter(Boolean),
  ]);
  return executeGit(
    cwd,
    args,
    signal,
    allowed,
    options,
    [...proxyKeys].flatMap((key) => ["-c", `${key}=`]),
  );
}
async function executeGit(
  cwd: string,
  args: string[],
  signal: AbortSignal | undefined,
  allowed: number[],
  options: { input?: Buffer; terminate?: typeof terminateProcessTree },
  proxyOverrides: string[] = [],
): Promise<{ stdout: Buffer; code: number }> {
  if (signal?.aborted) throw new AppError("CANCELLED", "任务已取消", "git");
  return new Promise((resolve, reject) => {
    const child = spawn(
      "git",
      [
        "-c",
        `core.hooksPath=${devNull}`,
        "-c",
        `core.attributesFile=${devNull}`,
        "-c",
        "core.fsmonitor=false",
        "-c",
        "submodule.recurse=false",
        ...proxyOverrides,
        ...args,
      ],
      {
        cwd,
        windowsHide: true,
        detached: process.platform !== "win32",
        shell: false,
        env: {
          ...gitEnvironment(),
          GIT_TERMINAL_PROMPT: "0",
          GCM_INTERACTIVE: "Never",
          GIT_ATTR_NOSYSTEM: "1",
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const output: Buffer[] = [];
    let size = 0;
    let stderr = "";
    let stopReason: AppError | null = null;
    let stopPromise: Promise<void> | null = null;
    const stop = (reason: AppError) => {
      if (stopPromise || !child.pid) return;
      stopReason = reason;
      stopPromise = (options.terminate ?? terminateProcessTree)(
        child.pid,
      ).catch((error: unknown) => {
        stopReason =
          error instanceof AppError
            ? error
            : new AppError("PROCESS_STOP_UNCONFIRMED", String(error), "git");
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
        reject(stopReason);
      });
    };
    const abort = () =>
      stop(new AppError("CANCELLED", "任务已取消，Git 进程已停止", "git"));
    signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(
      () =>
        stop(
          new AppError(
            "GIT_TIMEOUT",
            "Git 操作超过 5 分钟，已请求停止",
            "git",
            true,
          ),
        ),
      300000,
    );
    child.stdin.on("error", (error: NodeJS.ErrnoException) => {
      // EPIPE means Git already closed its input; the exit handler reports its diagnostic.
      if (error.code !== "EPIPE")
        stop(new AppError("GIT_INPUT_FAILED", error.message, "git"));
    });
    child.stdin.end(options.input);
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_OUTPUT)
        stop(new AppError("OUTPUT_LIMIT", "Git 输出超过 32 MiB 限制", "git"));
      else output.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      reject(
        new AppError(
          "GIT_UNAVAILABLE",
          `无法启动 Git：${error.message}`,
          "git",
        ),
      );
    });
    child.once("close", (code) => {
      void (async () => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
        await stopPromise;
        if (stopReason) {
          reject(stopReason);
          return;
        }
        if (!allowed.includes(code ?? -1)) {
          const safe = stderr
            .replace(/https?:\/\/\S+/g, "[远程地址已隐藏]")
            .replace(/(?:Bearer|token|password)[=: ]+\S+/gi, "[凭据已隐藏]");
          reject(
            new AppError(
              "GIT_FAILED",
              `Git ${args[0]} 失败（${code}）：${safe}`,
              "git",
              true,
            ),
          );
          return;
        }
        resolve({ stdout: Buffer.concat(output), code: code ?? -1 });
      })();
    });
  });
}
