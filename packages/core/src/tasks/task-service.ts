import { randomUUID } from "node:crypto";
import { AppError, errorData } from "../../../contracts/src/error";
import type {
  ContextSnapshot,
  RepositoryBinding,
  Task,
  TaskStatus,
  Project,
} from "../../../contracts/src/models";
import type { ContextSnapshot as Snapshot } from "../../../contracts/src/models";
import type {
  DocumentSnapshotRef,
  SourceGap,
} from "../../../contracts/src/documents";
import type { RequirementSet } from "../../../contracts/src/requirements";
import type { AnalysisReport } from "../../../contracts/src/analysis";
import type { BugReport } from "../../../contracts/src/issues";
import type { TaskRepository, RepositoryAdapter } from "../ports";
import type { ProjectService } from "../projects/project-service";

const humanActionCodes = new Set([
  "ISSUE_NOT_CONFIGURED",
  "ISSUE_OUT_OF_SCOPE",
  "ISSUE_CHANGED",
  "ISSUE_NOT_FOUND",
  "CLI_INSTANCE_MISMATCH",
  "TRINITY_LIST_UNVERIFIED",
  "FEISHU_NOT_CONFIGURED",
  "MODEL_NOT_CONFIGURED",
  "MODEL_KEY_MISSING",
  "OUTBOUND_NOT_APPROVED",
  "DOCUMENT_CHANGED",
  "REQUIREMENTS_STALE",
  "DOCUMENT_REQUIRED",
  "REQUIREMENTS_EMPTY",
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
export interface TaskRuntime {
  configurationHash(project: Project, kind?: Task["kind"]): string;
  prepareIssue?(task: Task, signal: AbortSignal): Promise<string>;
  captureDocuments(
    project: Project,
    signal: AbortSignal,
  ): Promise<{ documents: DocumentSnapshotRef[]; sourceGaps: SourceGap[] }>;
  indexContext(context: Snapshot, signal: AbortSignal): Promise<string[]>;
  analyze(
    task: Task,
    context: Snapshot,
    signal: AbortSignal,
    progress: (message: string) => void,
  ): Promise<
    | { kind: "extraction"; set: RequirementSet }
    | { kind: "report"; report: AnalysisReport }
    | { kind: "bug"; report: BugReport }
  >;
}
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
    private readonly runtime?: TaskRuntime,
  ) {
    for (const task of store.listTasks()) {
      if (
        ["PREPARING", "RUNNING", "VALIDATING", "CANCELLING"].includes(
          task.status,
        )
      )
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
    kind: Task["kind"],
    attempt = 1,
    requirementSetId?: string,
    issueSnapshotId?: string,
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
      projectRevision: project.revision,
      ...(kind !== "PREPARE_CONTEXT" && this.runtime
        ? {
            executionConfigurationHash: this.runtime.configurationHash(
              project,
              kind,
            ),
          }
        : {}),
      kind,
      attemptId: randomUUID(),
      ...(requirementSetId ? { requirementSetId } : {}),
      ...(issueSnapshotId ? { issueSnapshotId } : {}),
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
  private assertConfiguration(task: Task, project: Project): void {
    if (
      task.projectRevision !== project.revision ||
      this.projects.get(project.id).revision !== project.revision ||
      (task.kind !== "PREPARE_CONTEXT" &&
        this.runtime &&
        task.executionConfigurationHash !==
          this.runtime.configurationHash(project, task.kind))
    )
      throw new AppError(
        "PROJECT_CHANGED",
        "项目或 AI 连接配置已改变，请重新运行",
      );
  }
  async cancel(id: string): Promise<Task> {
    const task = this.get(id);
    if (task.status === "QUEUED")
      return this.transition(task, "CANCELLED", "排队任务已取消");
    if (
      ["PREPARING", "RUNNING", "VALIDATING"].includes(task.status) &&
      this.activeTaskId === id
    ) {
      this.transition(task, "CANCELLING", "正在停止本任务的网络请求及后台进程");
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
    return this.enqueue(
      task.projectId,
      task.kind,
      task.attempt + 1,
      task.requirementSetId,
      task.issueSnapshotId,
    );
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
      let analysisDeadline: AbortSignal | undefined;
      try {
        const project = this.projects.get(task.projectId);
        if (!project.enabled)
          throw new AppError("PROJECT_DISABLED", "项目已停用");
        this.assertConfiguration(task, project);
        let issueSnapshotId: string | undefined;
        if (task.kind === "ANALYZE_BUG") {
          if (!this.runtime?.prepareIssue)
            throw new AppError("ANALYSIS_UNAVAILABLE", "BUG 分析服务未装配");
          this.store.event(
            task.id,
            "ISSUE_REFRESH",
            "正在重新读取 BUG 并验证项目与负责人",
          );
          issueSnapshotId = await this.runtime.prepareIssue(
            task,
            this.controller.signal,
          );
        }
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
        this.assertConfiguration(task, project);
        if (project.documents.length && !this.runtime)
          throw new AppError(
            "DOCUMENT_SERVICE_UNAVAILABLE",
            "文档服务未装配，未发布不完整上下文",
          );
        if (this.runtime)
          this.store.event(task.id, "DOCUMENTS", "正在捕获并解析关联需求文档");
        const captured = this.runtime
          ? await this.runtime.captureDocuments(project, this.controller.signal)
          : { documents: [], sourceGaps: [] };
        const context: ContextSnapshot = {
          id: randomUUID(),
          projectId: project.id,
          configRevision: project.revision,
          ...(issueSnapshotId ? { issueSnapshotId } : {}),
          repositories: snapshots,
          documents: captured.documents,
          sourceGaps: captured.sourceGaps,
          createdAt: new Date().toISOString(),
          limitations: [
            ...(task.kind === "PREPARE_CONTEXT"
              ? ["本任务准备代码和文档快照，不代表完成需求核对或 BUG 分析"]
              : []),
            "子模块、Git LFS 和检出过滤器需要后续适配；敏感文件和符号链接不进入读取清单",
          ],
        };
        if (this.runtime) {
          this.store.event(task.id, "INDEXING", "正在建立固定快照检索索引");
          context.limitations.push(
            ...(await this.runtime.indexContext(
              context,
              this.controller.signal,
            )),
          );
        }
        let outcome: Awaited<ReturnType<TaskRuntime["analyze"]>> | undefined;
        this.assertConfiguration(task, project);
        if (task.kind !== "PREPARE_CONTEXT") {
          if (!this.runtime)
            throw new AppError("ANALYSIS_UNAVAILABLE", "分析执行器未装配");
          this.transition(this.get(task.id), "RUNNING", "正在执行分析与取证");
          analysisDeadline = AbortSignal.timeout(20 * 60 * 1000);
          outcome = await this.runtime.analyze(
            task,
            context,
            AbortSignal.any([this.controller.signal, analysisDeadline]),
            (message) => this.store.event(task.id, "ANALYSIS", message),
          );
          this.transition(
            this.get(task.id),
            "VALIDATING",
            "正在校验并保存分析结果",
          );
        }
        if (this.controller.signal.aborted)
          throw new AppError("CANCELLED", "任务已取消");
        this.assertConfiguration(task, project);
        if (outcome?.kind === "extraction")
          this.store.completeExtraction(
            { ...this.get(task.id), resultId: outcome.set.id },
            context,
            outcome.set,
          );
        else if (outcome?.kind === "report")
          this.store.completeAnalysis(
            { ...this.get(task.id), resultId: outcome.report.id },
            context,
            outcome.report,
          );
        else if (outcome?.kind === "bug")
          this.store.completeBug(
            { ...this.get(task.id), resultId: outcome.report.id },
            context,
            outcome.report,
          );
        else this.store.completeTask(this.get(task.id), context);
      } catch (error) {
        const data = errorData(
          analysisDeadline?.aborted && !this.controller.signal.aborted
            ? new AppError(
                "ANALYSIS_TIMEOUT",
                "分析超过 20 分钟上限，未提交成功结果",
              )
            : error,
        );
        if (data.code === "PROCESS_STOP_UNCONFIRMED") this.stopping = true;
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
