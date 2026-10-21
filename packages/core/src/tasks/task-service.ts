import {WorkGate} from "../runtime/work-gate";
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
  "ISSUE_LOG_REQUIRED", "ISSUE_LOG_CHANGED", "WORKTREE_CHANGED",
  "GIT_REBASE_CONFLICT", "GIT_NO_REBASE", "CONFLICT_UNSUPPORTED", "CONFLICT_CHANGED",
  "BUG_EVIDENCE_INSUFFICIENT",
  "ISSUE_NOT_CONFIGURED",
  "ISSUE_OUT_OF_SCOPE",
  "ISSUE_CHANGED",
  "ISSUE_STATUS_INACTIVE",
  "ISSUE_NOT_FOUND",
  "CLI_INSTANCE_MISMATCH",
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
  cancelIssueLogTask?(id:string):Promise<void>;
  retryIssueLogTask?(task:Task):Promise<Task>;
  prepareIssueMaterials?(task:Task,issueSnapshotId:string,signal:AbortSignal):Promise<import("../../../contracts/src/issue-materials").IssueLogSetRef|undefined>;
  captureCurrentCode?(binding:RepositoryBinding,signal:AbortSignal):Promise<import("../../../contracts/src/models").WorktreeRepositorySnapshot>;
  resolveCodeConflicts?(project: Project, binding: RepositoryBinding, signal: AbortSignal): Promise<void>;
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
    private readonly workGate=new WorkGate(),
  ) {
    for (const task of store.listTasks()) {
      if ((task.kind === "DOWNLOAD_ISSUE_LOGS" && task.status === "QUEUED") ||
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
    const task=this.store.getTask(id);
    if(task.deletedAt)throw new AppError("TASK_NOT_FOUND","任务记录已删除");
    return task;
  }
  list(projectId?: string): Task[] {
    return this.store.listTasks(projectId).filter(t=>!t.deletedAt);
  }
  async enqueue(
    projectId: string,
    kind: Task["kind"],
    attempt = 1,
    requirementSetId?: string,
    issueSnapshotId?: string,
    bugOptions?:import("../../../contracts/src/issue-materials").BugAnalysisOptions,
    issue?:{key:string;identity:string},
  ): Promise<Task> {
    this.workGate.assertAccepting();
    if (this.stopping)
      throw new AppError("SERVICE_STOPPING", "应用正在退出，请重新启动后操作");
    const project = this.projects.get(projectId);
    if (!project.enabled)
      throw new AppError("PROJECT_DISABLED", "项目已停用，请先启用项目");
    if(issue){const existing=this.list().find(t=>t.projectId===projectId&&t.kind===kind&&t.issueIdentity===issue.identity&&["QUEUED","PREPARING","RUNNING","VALIDATING","CANCELLING"].includes(t.status));if(existing)return existing;}
    const now = new Date().toISOString();
    const task: Task = {
      id: randomUUID(),
      projectId,
      projectName: project.name,
      projectRevision: project.revision,
      ...(!["PREPARE_CONTEXT", "UPDATE_CODE", "CONTINUE_CODE_UPDATE"].includes(kind) && this.runtime
        ? {
            executionConfigurationHash: this.runtime.configurationHash(
              project,
              kind,
            ),
          }
        : {}),
      kind,
      ...(issue?{issueKey:issue.key,issueIdentity:issue.identity}:{}),
      ...(kind === "ANALYZE_BUG" ? {bugOptions:bugOptions??{logPolicy:"required" as const}} : {}),
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
      (!["PREPARE_CONTEXT", "UPDATE_CODE", "CONTINUE_CODE_UPDATE"].includes(task.kind) &&
        this.runtime &&
        task.executionConfigurationHash !==
          this.runtime.configurationHash(project, task.kind))
    )
      throw new AppError(
        "PROJECT_CHANGED",
        "项目或 AI 连接配置已改变，请重新运行",
      );
  }
  delete(id:string):void {
    const task=this.get(id);
    if(["QUEUED","PREPARING","RUNNING","VALIDATING","CANCELLING"].includes(task.status))throw new AppError("TASK_ACTIVE","请先取消任务，等待停止后再删除记录");
    this.store.saveTask({...task,deletedAt:new Date().toISOString()});
  }
  async cancel(id: string): Promise<Task> {
    const task = this.get(id);
    if(task.kind === "DOWNLOAD_ISSUE_LOGS"){
      if(!this.runtime?.cancelIssueLogTask)throw new AppError("ANALYSIS_UNAVAILABLE","日志任务服务未装配");
      if(!["QUEUED","PREPARING","RUNNING","VALIDATING","CANCELLING"].includes(task.status))return task;
      this.transition(task,"CANCELLING","正在取消独立日志下载任务");
      await this.runtime.cancelIssueLogTask(id);return this.get(id);
    }
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
    if(task.kind === "DOWNLOAD_ISSUE_LOGS"){
      if(!this.runtime?.retryIssueLogTask)throw new AppError("ANALYSIS_UNAVAILABLE","日志任务服务未装配");
      return this.runtime.retryIssueLogTask(task);
    }
    return this.enqueue(
      task.projectId,
      task.kind,
      task.attempt + 1,
      task.requirementSetId,
      task.issueSnapshotId,
      task.bugOptions,
      task.issueIdentity&&task.issueKey?{identity:task.issueIdentity,key:task.issueKey}:undefined,
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
          this.list().some((task) => task.status === "QUEUED" && task.kind !== "DOWNLOAD_ISSUE_LOGS")
        )
          this.schedule();
      });
  }
  private async pump(): Promise<void> {
    while (!this.stopping) {
      const task = this.list()
        .filter((item) => item.status === "QUEUED" && item.kind !== "DOWNLOAD_ISSUE_LOGS")
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
        if (["UPDATE_CODE", "CONTINUE_CODE_UPDATE", "RESOLVE_CODE_CONFLICTS"].includes(task.kind)) {
          if (!this.git.update || !this.git.continueUpdate) throw new AppError("GIT_UPDATE_UNAVAILABLE", "代码更新服务未装配");
          for (const binding of project.repositories) {
            this.assertConfiguration(task, project);
            this.store.event(task.id, "GIT_UPDATE", `更新代码：${binding.canonicalPath} · ${binding.branch}`);
            if (task.kind === "RESOLVE_CODE_CONFLICTS") {
              if (!this.runtime?.resolveCodeConflicts) throw new AppError("MODEL_NOT_CONFIGURED", "AI 冲突处理未配置");
              await this.runtime.resolveCodeConflicts(project, binding, this.controller.signal);
            }
            if (task.kind === "UPDATE_CODE") await this.git.update(binding, this.controller.signal);
            else await this.git.continueUpdate(binding, this.controller.signal);
          }
          this.assertConfiguration(task, project);
          this.transition(this.get(task.id), "SUCCEEDED", "代码更新完成；未读取需求文档或创建分析上下文，未推送远端");
          continue;
        }
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
        let issueLogs:import("../../../contracts/src/issue-materials").IssueLogSetRef|undefined;
        if(task.kind === "ANALYZE_BUG") {
          if(!this.runtime?.prepareIssueMaterials||!this.runtime.captureCurrentCode)throw new AppError("ANALYSIS_UNAVAILABLE","日志和当前代码捕获服务未装配");
          this.store.event(task.id,"ISSUE_LOGS",task.bugOptions?.logPolicy === "code-only" ? "用户明确选择仅按代码和问题描述分析，跳过日志" : "等待独立日志下载任务完成，随后读取日志材料");
          issueLogs=await this.runtime.prepareIssueMaterials(task,issueSnapshotId!,this.controller.signal);
        }
        const previous = this.store.latestContext(project.id);
        const bindings: RepositoryBinding[] = project.repositories.map(binding => {
          const prior = previous?.repositories.find(repo=>repo.bindingId===binding.id);
          return {...binding,remoteUrlFingerprint:binding.remoteUrlFingerprint ?? (prior?.kind !== "worktree" ? prior?.remoteUrlFingerprint : null) ?? null};
        });
        // Global serial execution is the first-release lock: no two tasks can touch a repository at once.
        if(task.kind !== "ANALYZE_BUG")for (const binding of bindings)
          this.git.assertReady(
            await this.git.inspect(binding, this.controller.signal),
          );
        const snapshots = [];
        for (const binding of bindings) {
          this.store.event(
            task.id,
            task.kind === "ANALYZE_BUG" ? "CODE_SNAPSHOT" : "GIT_SYNC",
            task.kind === "ANALYZE_BUG" ? `正在捕获当前代码（包含未提交修改）：${binding.role}` : `正在更新 ${binding.role || "代码仓库"}：${binding.branch}`,
          );
          snapshots.push(
            task.kind === "ANALYZE_BUG" ? await this.runtime!.captureCurrentCode!(binding,this.controller.signal) : await this.git.synchronize(binding, this.controller.signal),
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
          ...(issueLogs ? {issueLogs} : {}),
          repositories: snapshots,
          documents: captured.documents,
          sourceGaps: captured.sourceGaps,
          createdAt: new Date().toISOString(),
          limitations: [
            ...(task.bugOptions?.logPolicy === "code-only" ? ["用户明确选择仅按代码和问题描述分析，未读取问题日志"] : []),
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
          this.controller.signal.aborted && !(error instanceof AppError && error.code === "PROCESS_STOP_UNCONFIRMED") ? new AppError("CANCELLED","任务已取消") : analysisDeadline?.aborted && !this.controller.signal.aborted
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
