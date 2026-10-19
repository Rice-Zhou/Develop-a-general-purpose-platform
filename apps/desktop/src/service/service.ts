import { join } from "node:path";
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
            name: "需求文档与实现核对",
            available: false,
            reason: "第二阶段：Word、PDF、飞书和模型 API",
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
            name: "本机 AI 编码工具",
            available: false,
            reason: "第五阶段：需要工具能力与只读验证",
          },
        ],
      };
      return info;
    }
    default:
      throw new AppError("HOST_ONLY", "该操作只能通过桌面系统能力执行");
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
    };
    try {
      if (envelope.type === "init") {
        if (store) throw new AppError("ALREADY_INITIALIZED", "服务已初始化");
        if (!envelope.dataPath || !envelope.version)
          throw new AppError("INIT_INVALID", "服务初始化参数缺失");
        dataPath = envelope.dataPath;
        version = envelope.version;
        store = new DataStore(join(dataPath, "platform.db"));
        projects = new ProjectService(store);
        tasks = new TaskService(store, projects, git);
        parent.postMessage({ type: "ready" });
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
