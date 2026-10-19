import { randomUUID } from "node:crypto";
import { AppError, errorData } from "../../../contracts/src/error";
import type {
  ContextSnapshot,
  RepositoryBinding,
  Task,
  TaskStatus,
} from "../../../contracts/src/models";
import type { TaskRepository, RepositoryAdapter } from "../ports";
import type { ProjectService } from "../projects/project-service";

const humanActionCodes = new Set([
  "WORKTREE_DIRTY",
  "BRANCH_MISMATCH",
  "TRACKING_MISSING",
  "LOCAL_AHEAD",
  "BRANCH_DIVERGED",
  "REMOTE_CHANGED",
  "GIT_OPERATION_PENDING",
  "FILTER_UNSUPPORTED",
  "SUBMODULE_UNSUPPORTED",
  "PROJECT_DISABLED",
  "PROJECT_CHANGED",
]);
const retryableStatuses: TaskStatus[] = [
  "FAILED",
  "WAITING_INPUT",
  "INTERRUPTED",
  "CANCELLED",
];
export class TaskService {
  private stopping = false;
  private running: Promise<void> | null = null;
  private controller: AbortController | null = null;
  private activeTaskId: string | null = null;
  constructor(
    private readonly store: TaskRepository,
    private readonly projects: ProjectService,
    private readonly git: RepositoryAdapter,
  ) {
    for (const task of store.listTasks()) {
      if (task.status === "PREPARING" || task.status === "CANCELLING")
        this.transition(
          task,
          "INTERRUPTED",
          "上次运行意外中断，请检查分析目录后重试",
        );
    }
    this.schedule();
  }
  get(id: string): Task {
    return this.store.getTask(id);
  }
  list(projectId?: string): Task[] {
    return this.store.listTasks(projectId);
  }
  async enqueue(
    projectId: string,
    _kind: "PREPARE_CONTEXT",
    attempt = 1,
  ): Promise<Task> {
    if (this.stopping)
      throw new AppError("SERVICE_STOPPING", "应用正在退出，请重新启动后操作");
    const project = this.projects.get(projectId);
    if (!project.enabled)
      throw new AppError("PROJECT_DISABLED", "项目已停用，请先启用项目");
    const now = new Date().toISOString();
    const task: Task = {
      id: randomUUID(),
      projectId,
      projectName: project.name,
      kind: "PREPARE_CONTEXT",
      status: "QUEUED",
      attempt,
      createdAt: now,
      updatedAt: now,
      error: null,
      contextSnapshotId: null,
    };
    this.store.saveTask(task);
    this.store.event(task.id, "QUEUED", "任务已加入队列");
    this.schedule();
    return task;
  }
  private transition(task: Task, status: TaskStatus, message: string): Task {
    const next = { ...task, status, updatedAt: new Date().toISOString() };
    this.store.saveTask(next);
    this.store.event(task.id, status, message);
    return next;
  }
  async cancel(id: string): Promise<Task> {
    const task = this.get(id);
    if (task.status === "QUEUED")
      return this.transition(task, "CANCELLED", "排队任务已取消");
    if (task.status === "PREPARING" && this.activeTaskId === id) {
      this.transition(task, "CANCELLING", "正在停止本任务的 Git 进程");
      this.controller?.abort();
      return this.get(id);
    }
    return task;
  }
  async retry(id: string): Promise<Task> {
    const task = this.get(id);
    if (!retryableStatuses.includes(task.status))
      throw new AppError(
        "TASK_NOT_RETRYABLE",
        "只有失败、等待处理、中断或取消的任务可以重试",
      );
    return this.enqueue(task.projectId, task.kind, task.attempt + 1);
  }
  private schedule(): void {
    if (this.running || this.stopping) return;
    this.running = Promise.resolve()
      .then(() => this.pump())
      .finally(() => {
        this.running = null;
        if (
          !this.stopping &&
          this.list().some((task) => task.status === "QUEUED")
        )
          this.schedule();
      });
  }
  private async pump(): Promise<void> {
    while (!this.stopping) {
      const task = this.list()
        .filter((item) => item.status === "QUEUED")
        .at(-1);
      if (!task) return;
      this.activeTaskId = task.id;
      this.controller = new AbortController();
      this.transition(task, "PREPARING", "正在验证项目及全部仓库");
      try {
        const project = this.projects.get(task.projectId);
        if (!project.enabled)
          throw new AppError("PROJECT_DISABLED", "项目已停用");
        const previous = this.store.latestContext(project.id);
        const bindings: RepositoryBinding[] = project.repositories.map(
          (binding) => ({
            ...binding,
            remoteUrlFingerprint:
              binding.remoteUrlFingerprint ??
              previous?.repositories.find(
                (repo) => repo.bindingId === binding.id,
              )?.remoteUrlFingerprint ??
              null,
          }),
        );
        // Global serial execution is the first-release lock: no two tasks can touch a repository at once.
        for (const binding of bindings)
          this.git.assertReady(
            await this.git.inspect(binding, this.controller.signal),
          );
        const snapshots = [];
        for (const binding of bindings) {
          this.store.event(
            task.id,
            "GIT_SYNC",
            `正在更新 ${binding.role || "代码仓库"}：${binding.branch}`,
          );
          snapshots.push(
            await this.git.synchronize(binding, this.controller.signal),
          );
        }
        if (this.controller.signal.aborted)
          throw new AppError("CANCELLED", "任务已取消");
        if (this.projects.get(project.id).revision !== project.revision)
          throw new AppError(
            "PROJECT_CHANGED",
            "准备过程中项目配置已改变，请重新运行",
          );
        const context: ContextSnapshot = {
          id: randomUUID(),
          projectId: project.id,
          configRevision: project.revision,
          repositories: snapshots,
          documents: [],
          createdAt: new Date().toISOString(),
          limitations: [
            "本阶段仅准备代码快照，未执行需求核对或 BUG 分析",
            ...(project.documents.length
              ? ["关联文档尚未解析，不包含在本次代码快照中"]
              : []),
            "子模块、Git LFS 和检出过滤器需要后续适配；敏感文件和符号链接不进入读取清单",
          ],
        };
        this.store.completeTask(this.get(task.id), context);
      } catch (error) {
        const data = errorData(error);
        if (data.code === 'PROCESS_STOP_UNCONFIRMED') this.stopping = true;
        const current = this.get(task.id);
        const status: TaskStatus =
          data.code === "CANCELLED"
            ? "CANCELLED"
            : humanActionCodes.has(data.code)
              ? "WAITING_INPUT"
              : "FAILED";
        this.store.saveTask({
          ...current,
          error: status === "CANCELLED" ? null : data,
          status,
          updatedAt: new Date().toISOString(),
        });
        this.store.event(task.id, status, data.message);
      } finally {
        this.activeTaskId = null;
        this.controller = null;
      }
    }
  }
  async shutdown(): Promise<void> {
    this.stopping = true;
    this.controller?.abort();
    await this.running;
  }
}
