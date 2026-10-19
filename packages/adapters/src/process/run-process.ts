import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";
import { AppError } from "../../../contracts/src/error";
import { terminateProcessTree } from "../git/process-tree";
import { directEnvironment } from "../network/policy";
export interface ProcessOptions {
  cwd: string;
  input?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxOutput?: number;
  env?: NodeJS.ProcessEnv;
}
export class ProcessExitError extends AppError {
  constructor(
    public readonly exitCode: number | null,
    public readonly diagnostic: string,
  ) {
    super(
      "PROCESS_FAILED",
      `工具退出码 ${exitCode}。${diagnostic || "请检查工具登录、权限及版本"}`,
    );
  }
}
export function runProcess(
  executable: string,
  args: string[],
  options: ProcessOptions,
): Promise<string> {
  if (!isAbsolute(executable))
    return Promise.reject(
      new AppError(
        "CLI_PATH_INVALID",
        "必须配置实际可执行文件的绝对路径，不能使用命令模板",
      ),
    );
  if (options.signal?.aborted)
    return Promise.reject(new AppError("CANCELLED", "进程调用已取消"));
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      windowsHide: true,
      shell: false,
      detached: process.platform !== "win32",
      env: options.env ?? directEnvironment(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let count = 0;
    let diagnostic = "";
    let reason: AppError | null = null;
    let stopping: Promise<void> | null = null;
    const clean = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    };
    const stop = (error: AppError) => {
      if (stopping || !child.pid) return;
      reason = error;
      stopping = terminateProcessTree(child.pid).catch((failure: unknown) => {
        reason =
          failure instanceof AppError
            ? failure
            : new AppError("PROCESS_STOP_UNCONFIRMED", "无法确认进程退出");
        clean();
        reject(reason);
      });
    };
    const abort = () => stop(new AppError("CANCELLED", "本次进程调用已取消"));
    const timer = setTimeout(
      () => stop(new AppError("PROCESS_TIMEOUT", "进程调用超时，已终止进程树")),
      options.timeoutMs ?? 30000,
    );
    options.signal?.addEventListener("abort", abort, { once: true });
    child.stdin.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPIPE")
        stop(new AppError("PROCESS_INPUT_FAILED", "无法传入任务材料"));
    });
    child.stdin.end(options.input);
    child.stdout.on("data", (buffer: Buffer) => {
      count += buffer.length;
      if (count > (options.maxOutput ?? 8 * 1024 * 1024))
        stop(new AppError("PROCESS_OUTPUT_LIMIT", "进程输出超过限制"));
      else chunks.push(buffer);
    });
    child.stderr.on("data", (part: Buffer) => {
      diagnostic = (diagnostic + part.toString("utf8")).slice(-4000);
    });
    child.once("error", () => {
      clean();
      reject(
        new AppError(
          "PROCESS_UNAVAILABLE",
          "无法启动配置的可执行文件，请检查路径和执行权限",
        ),
      );
    });
    child.once("close", (code) => {
      void (async () => {
        clean();
        await stopping;
        if (reason) {
          reject(reason);
          return;
        }
        if (code !== 0) {
          reject(
            new ProcessExitError(
              code,
              diagnostic
                .replace(/https?:\/\/\S+/gi, "[地址已隐藏]")
                .replace(
                  /(?:Bearer|token|password|api[_-]?key)["']?\s*[=: ]+\s*["']?[^\s,"']+/gi,
                  "[凭据已隐藏]",
                )
                .replace(/sk-[a-zA-Z0-9_-]{8,}/g, "[密钥已隐藏]")
                .replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
                .slice(0, 2000)
                .trim(),
            ),
          );
          return;
        }
        resolve(Buffer.concat(chunks).toString("utf8"));
      })();
    });
  });
}
