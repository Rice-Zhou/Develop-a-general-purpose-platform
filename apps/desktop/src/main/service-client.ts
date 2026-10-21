import { utilityProcess, type UtilityProcess } from "electron";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { AppError, errorData } from "../../../../packages/contracts/src/error";
import type { FileCredentialStore } from "../../../../packages/storage/src/credential-store";
import type { Result } from "../../../../packages/contracts/src/models";
import type { Request } from "../../../../packages/contracts/src/ipc";
import { ISSUE_REFRESH_TIMEOUT_MS, JIRA_DISCOVERY_TIMEOUT_MS } from "../../../../packages/contracts/src/issues";
import { WindowsJob } from "../../../../packages/adapters/src/windows/job";

export class ServiceClient {
  private child: UtilityProcess | null = null;
  private ready: Promise<void> | null = null;
  private cleanup: Promise<void> = Promise.resolve();
  private fatalError: AppError | null = null;
  private stopping = false;
  private monitorStarted = false;
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
    private readonly credentials: FileCredentialStore,
  ) {}
  private ensureReady(): Promise<void> {
    if (this.stopping)
      return Promise.reject(new AppError("SERVICE_STOPPING", "应用正在退出"));
    if (!this.ready) this.ready = this.start();
    return this.ready;
  }
  private async start(): Promise<void> {
    // Never initialize a replacement worker until the old job has no surviving processes.
    await this.cleanup;
    if (this.fatalError) throw this.fatalError;
    return new Promise((resolve, reject) => {
      const job = new WindowsJob();
      const child = utilityProcess.fork(join(__dirname, "service.cjs"), [], {
        serviceName: "本地研发服务",
        stdio: "pipe",
      });
      this.child = child;
      const timer = setTimeout(() => {
        reject(new AppError("SERVICE_TIMEOUT", "本地服务启动超时"));
        this.reclaim(job);
      }, 30000);
      child.stderr?.on("data", (chunk) =>
        console.error("[service]", String(chunk)),
      );
      child.once("spawn", () => {
        try {
          job.assign(child.pid!);
          // The worker performs no repository operations before this message.
          child.postMessage({
            type: "init",
            dataPath: this.dataPath,
            version: this.version,
            startMonitor: this.monitorStarted,
          });
        } catch (error) {
          clearTimeout(timer);
          this.fatalError =
            error instanceof AppError
              ? error
              : new AppError("PROCESS_OWNERSHIP_FAILED", String(error));
          reject(this.fatalError);
          child.kill();
          this.reclaim(job);
        }
      });
      child.on(
        "message",
        (message: {
          type?: string;
          id?: string;
          result?: Result<unknown>;
          profileId?: string;
          ref?: string;
          requestId?: string;
        }) => {
          if (message.type === "credential-request") {
            void (async () => {
              let result: Result<string>;
              try {
                if (!message.ref || !message.profileId)
                  throw new AppError(
                    "CREDENTIAL_SCOPE_MISMATCH",
                    "缺少凭据归属",
                  );
                result = {
                  ok: true,
                  value: await this.credentials.resolve(
                    message.ref,
                    message.profileId,
                  ),
                };
              } catch (error) {
                result = { ok: false, error: errorData(error) };
              }
              if (this.child === child)
                child.postMessage({
                  type: "credential-result",
                  requestId: message.requestId,
                  result,
                });
            })();
            return;
          }
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
            this.reclaim(job);
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
        this.reclaim(job);
        const error = new AppError(
          "SERVICE_EXITED",
          `本地服务退出（${code}）。旧进程回收完成后重新连接，中断任务保留在历史中`,
        );
        reject(error);
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timer);
          pending.reject(error);
        }
        this.pending.clear();
      });
    });
  }
  private reclaim(job: WindowsJob): void {
    this.cleanup = job.terminateAndClose().catch((error) => {
      this.fatalError =
        error instanceof AppError
          ? error
          : new AppError("PROCESS_STOP_UNCONFIRMED", String(error));
      console.error("[process ownership]", this.fatalError.message);
    });
  }
  async request(request: Request): Promise<Result<unknown>> {
    await this.ensureReady();
    return this.send(
      { request },
      request.method === "probeExecutor" || request.method === "discoverCodex" ? 90000 : request.method === "refreshBugWorkspace"
        ? ISSUE_REFRESH_TIMEOUT_MS + 35000
        : request.method === "checkIssueNotifications" || request.method === "associateTrinityIssue"
          ? 35000
          : request.method === "refreshIssues" || request.method === "getTrinityProjects"
        ? ISSUE_REFRESH_TIMEOUT_MS + 5000
        : request.method === "getJiraCatalogue" || request.method === "saveProject"
          ? JIRA_DISCOVERY_TIMEOUT_MS + 5000
        : 30000,
    );
  }
  async backup(destination: string): Promise<Result<unknown>> {
    await this.ensureReady();
    return this.send({ type: "backup", destination });
  }
  async startIssueMonitor():Promise<void> {
    this.monitorStarted=true;
    const result=await this.control("start-issue-monitor",{});
    if(!result.ok)throw new AppError(result.error.code,result.error.message);
  }
  async control(
    action:
      | "freeze-for-update"
      | "release-update-freeze"
      | "save-profile"
      | "get-profile"
      | "delete-profile"
      | "export-report"
      | "start-issue-monitor"
      | "get-issue-connections"
      | "save-issue-connection"
      | "get-issue-connection"
      | "delete-issue-connection"
      | "get-issue-url"
      | "get-issue-material-path"
      | "export-bug-report",
    payload: unknown,
  ): Promise<Result<unknown>> {
    await this.ensureReady();
    return this.send({ type: "control", action, payload },action === "save-profile" ? 90000 : 30000);
  }
  private send(envelope: object, timeoutMs = 30000): Promise<Result<unknown>> {
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
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child!.postMessage({ ...envelope, id });
    });
  }
  private stopFlight:Promise<void>|null=null;
  stop():Promise<void>{return this.stopFlight??(this.stopFlight=this.stopOnce());}
  private async stopOnce(): Promise<void> {
    if (this.child) {
      await this.ready;
      this.stopping = true;
      const child = this.child;
      const exited = new Promise<void>((resolve) =>
        child.once("exit", () => resolve()),
      );
      const result = await this.send({ type: "shutdown" });
      if (!result.ok)
        throw new AppError(result.error.code, result.error.message);
      await exited;
    }
    this.stopping = true;
    await this.cleanup;
    if (this.fatalError) throw this.fatalError;
  }
}
