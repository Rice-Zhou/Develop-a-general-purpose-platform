import { utilityProcess, type UtilityProcess } from "electron";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { AppError } from "../../../../packages/contracts/src/error";
import type { Result } from "../../../../packages/contracts/src/models";
export class ServiceClient {
  private child: UtilityProcess | null = null;
  private ready: Promise<void> | null = null;
  private stopping = false;
  private readonly pending = new Map<
    string,
    {
      resolve: (result: Result<unknown>) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  constructor(
    private readonly dataPath: string,
    private readonly version: string,
  ) {}
  private ensureReady(): Promise<void> {
    if (this.stopping)
      return Promise.reject(new AppError("SERVICE_STOPPING", "应用正在退出"));
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      const child = utilityProcess.fork(join(__dirname, "service.cjs"), [], {
        serviceName: "本地研发服务",
        stdio: "pipe",
      });
      this.child = child;
      const timer = setTimeout(
        () =>
          reject(
            new AppError("SERVICE_TIMEOUT", "本地服务启动超时，请查看应用错误"),
          ),
        30000,
      );
      child.stderr?.on("data", (chunk) =>
        console.error("[service]", String(chunk)),
      );
      child.on(
        "message",
        (message: { type?: string; id?: string; result?: Result<unknown> }) => {
          if (message.type === "ready") {
            clearTimeout(timer);
            resolve();
            return;
          }
          if (message.type === "init-error") {
            clearTimeout(timer);
            reject(
              new AppError(
                "SERVICE_INIT_FAILED",
                message.result && !message.result.ok
                  ? message.result.error.message
                  : "服务初始化失败",
              ),
            );
            return;
          }
          if (!message.id || !message.result) return;
          const pending = this.pending.get(message.id);
          if (!pending) return;
          clearTimeout(pending.timer);
          this.pending.delete(message.id);
          pending.resolve(message.result);
        },
      );
      child.once("exit", (code) => {
        clearTimeout(timer);
        this.child = null;
        this.ready = null;
        const error = new AppError(
          "SERVICE_EXITED",
          `本地服务退出（${code}），下次请求将重新连接；中断任务可在历史中重试`,
        );
        reject(error);
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timer);
          pending.reject(error);
        }
        this.pending.clear();
      });
      child.postMessage({
        type: "init",
        dataPath: this.dataPath,
        version: this.version,
      });
    });
    return this.ready;
  }
  async request(request: unknown): Promise<Result<unknown>> {
    await this.ensureReady();
    return this.send({ request });
  }
  async backup(destination: string): Promise<Result<unknown>> {
    await this.ensureReady();
    return this.send({ type: "backup", destination });
  }
  private send(envelope: object): Promise<Result<unknown>> {
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new AppError(
            "REQUEST_TIMEOUT",
            "本地请求超时，请查看任务历史确认执行状态",
          ),
        );
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.child!.postMessage({ ...envelope, id });
    });
  }
  async stop(): Promise<void> {
    if (!this.child) {
      this.stopping = true;
      return;
    }
    await this.ready;
    this.stopping = true;
    const result = await this.send({ type: "shutdown" });
    if (!result.ok) throw new AppError(result.error.code, result.error.message);
  }
}
