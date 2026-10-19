import { spawn } from "node:child_process";
import { devNull } from "node:os";
import { AppError } from "../../../contracts/src/error";
import { terminateProcessTree } from './process-tree';
const MAX_OUTPUT = 32 * 1024 * 1024;
export async function runGit(
  cwd: string,
  args: string[],
  signal?: AbortSignal,
  allowed = [0],
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
        ...args,
      ],
      {
        cwd,
        windowsHide: true,
        detached: process.platform !== 'win32',
        shell: false,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          GCM_INTERACTIVE: "Never",
          GIT_ATTR_NOSYSTEM: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
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
      stopPromise = terminateProcessTree(child.pid).catch((error: unknown) => {
        stopReason = error instanceof AppError ? error : new AppError('PROCESS_STOP_UNCONFIRMED', String(error), 'git');
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
    child.once("close", (code) => { void (async () => {
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
    })(); });
  });
}
