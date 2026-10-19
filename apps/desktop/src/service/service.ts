import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Workbench } from "./workbench";
import { DataStore } from "../../../../packages/storage/src/database";
import { ProjectService } from "../../../../packages/core/src/projects/project-service";
import { TaskService } from "../../../../packages/core/src/tasks/task-service";
import { GitRepositoryAdapter } from "../../../../packages/adapters/src/git/repository";
import { runGit } from "../../../../packages/adapters/src/git/git-process";
import {
  parseRequest,
  type Request,
} from "../../../../packages/contracts/src/ipc";
import { AppError, errorData } from "../../../../packages/contracts/src/error";
import type { AppInfo } from "../../../../packages/contracts/src/models";

const parent = (
  process as NodeJS.Process & {
    parentPort: {
      on(event: "message", handler: (event: { data: unknown }) => void): void;
      postMessage(message: unknown): void;
    };
  }
).parentPort;
let store: DataStore | null = null;
let projects: ProjectService;
let tasks: TaskService;
let workbench: Workbench;
const credentials = new Map<
  string,
  {
    resolve: (value: string) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }
>();
function resolveCredential(profileId: string, ref: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const requestId = randomUUID();
    const timer = setTimeout(() => {
      credentials.delete(requestId);
      reject(new AppError("CREDENTIAL_TIMEOUT", "凭据代理超时"));
    }, 30000);
    credentials.set(requestId, { resolve, reject, timer });
    parent.postMessage({
      type: "credential-request",
      requestId,
      profileId,
      ref,
    });
  });
}
let dataPath = "";
let version = "";
const git = new GitRepositoryAdapter();
async function dispatch(request: Request): Promise<unknown> {
  if (!store) throw new AppError("SERVICE_NOT_READY", "本地服务尚未就绪");
  switch (request.method) {
    case "listProjects":
      return projects.list();
    case "saveProject":
      return projects.save(
        request.params.draft,
        request.params.expectedRevision,
      );
    case "inspectRepository":
      return git.inspect(request.params.binding);
    case "prepareContext":
      return tasks.enqueue(request.params.projectId, "PREPARE_CONTEXT");
    case "listTasks":
      return tasks.list(request.params.projectId);
    case "getTaskEvents":
      return store.taskEvents(request.params.taskId);
    case "getContext":
      return store.getContext(request.params.snapshotId);
    case "cancelTask":
      return tasks.cancel(request.params.taskId);
    case "retryTask":
      return tasks.retry(request.params.taskId);
    case "getAppInfo": {
      let gitAvailable = true;
      let gitDiagnostic: string | null = null;
      try {
        await runGit(dataPath, ["--version"]);
      } catch (error) {
        gitAvailable = false;
        gitDiagnostic = errorData(error).message;
      }
      const info: AppInfo = {
        version,
        dataPath,
        gitAvailable,
        gitDiagnostic,
        capabilities: [
          {
            name: "项目与代码上下文",
            available: gitAvailable,
            reason:
              gitDiagnostic ??
              "本地配置、分支检查、安全同步、固定提交和任务历史",
          },
          {
            name: "本地文档与需求管理",
            available: true,
            reason:
              "DOCX、文本 PDF、固定文档快照、检索与人工需求版本；飞书需保存 CLI 配置",
          },
          {
            name: "Jira 与 Trinity",
            available: false,
            reason: "第三阶段：需要真实实例接口联调",
          },
          {
            name: "BUG 自动监控",
            available: false,
            reason: "第四阶段：在问题连接器验证后接入",
          },
          {
            name: "模型 API 与订阅工具",
            available: workbench.profiles().some((p) => p.outboundEnabled),
            reason:
              "支持配置模型地址及模型名、Codex / Claude Code 工具；连接与实际账号能力需分别验证",
          },
        ],
      };
      return info;
    }
    default:
      return workbench.dispatch(request, tasks);
  }
}
parent.on("message", (event) => {
  void (async () => {
    const envelope = event.data as {
      type?: string;
      id?: string;
      request?: unknown;
      dataPath?: string;
      version?: string;
      destination?: string;
      requestId?: string;
      result?: {
        ok: boolean;
        value?: string;
        error?: { code: string; message: string };
      };
      action?: string;
      payload?: unknown;
    };
    try {
      if (envelope.type === "credential-result") {
        const pending = credentials.get(envelope.requestId ?? "");
        if (!pending) return;
        clearTimeout(pending.timer);
        credentials.delete(envelope.requestId!);
        if (envelope.result?.ok && typeof envelope.result.value === "string")
          pending.resolve(envelope.result.value);
        else
          pending.reject(
            new AppError(
              envelope.result?.error?.code ?? "CREDENTIAL_FAILED",
              envelope.result?.error?.message ?? "凭据代理失败",
            ),
          );
        return;
      }
      if (envelope.type === "init") {
        if (store) throw new AppError("ALREADY_INITIALIZED", "服务已初始化");
        if (!envelope.dataPath || !envelope.version)
          throw new AppError("INIT_INVALID", "服务初始化参数缺失");
        dataPath = envelope.dataPath;
        version = envelope.version;
        store = await DataStore.open(join(dataPath, "platform.db"));
        projects = new ProjectService(store);
        workbench = new Workbench(
          store,
          git,
          dataPath,
          join(__dirname, "parser-worker.cjs"),
          resolveCredential,
        );
        tasks = new TaskService(store, projects, git, workbench);
        parent.postMessage({ type: "ready" });
        return;
      }
      if (envelope.type === "control") {
        if (!store) throw new AppError("SERVICE_NOT_READY", "本地服务尚未就绪");
        let value: unknown;
        if (envelope.action === "save-profile")
          value = workbench.saveProfile(envelope.payload);
        else if (envelope.action === "get-profile")
          value = workbench.profile(
            z.object({ id: z.uuid() }).strict().parse(envelope.payload).id,
          );
        else if (envelope.action === "delete-profile") {
          workbench.deleteProfile(
            z.object({ id: z.uuid() }).strict().parse(envelope.payload).id,
          );
          value = null;
        } else if (envelope.action === "export-report") {
          const payload = z
            .object({ projectId: z.uuid(), reportId: z.uuid() })
            .strict()
            .parse(envelope.payload);
          value = workbench.exportMarkdown(payload.projectId, payload.reportId);
        } else throw new AppError("CONTROL_INVALID", "未知内部操作");
        parent.postMessage({ id: envelope.id, result: { ok: true, value } });
        return;
      }
      if (envelope.type === "shutdown") {
        await tasks.shutdown();
        store?.close();
        parent.postMessage({
          id: envelope.id,
          result: { ok: true, value: null },
        });
        process.exitCode = 0;
        setTimeout(() => process.exit(0), 30);
        return;
      }
      if (envelope.type === "backup") {
        if (!envelope.destination || !store)
          throw new AppError("BACKUP_INVALID", "备份目标或数据库无效");
        await store.backup(envelope.destination);
        parent.postMessage({
          id: envelope.id,
          result: { ok: true, value: envelope.destination },
        });
        return;
      }
      const value = await dispatch(parseRequest(envelope.request));
      parent.postMessage({ id: envelope.id, result: { ok: true, value } });
    } catch (error) {
      parent.postMessage({
        id: envelope.id,
        type: envelope.type === "init" ? "init-error" : "response",
        result: { ok: false, error: errorData(error) },
      });
    }
  })();
});
