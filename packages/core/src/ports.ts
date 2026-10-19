import type {
  ContextSnapshot,
  Project,
  RepositoryBinding,
  RepositoryInspection,
  RepositorySnapshot,
  Task,
  TaskEvent,
} from "../../contracts/src/models";
import type { RequirementSet } from "../../contracts/src/requirements";
import type { AnalysisReport } from "../../contracts/src/analysis";
import type { BugReport } from "../../contracts/src/issues";
export interface ProjectRepository {
  listProjects(): Project[];
  getProject(id: string): Project;
  saveProject(project: Project, expectedRevision?: number): void;
}
export interface TaskRepository {
  completeBug(task: Task, context: ContextSnapshot, report: BugReport): void;
  listTasks(projectId?: string): Task[];
  getTask(id: string): Task;
  saveTask(task: Task): void;
  event(taskId: string, stage: string, message: string): void;
  taskEvents(id: string): TaskEvent[];
  completeTask(task: Task, context: ContextSnapshot): void;
  latestContext(projectId: string): ContextSnapshot | null;
  completeExtraction(
    task: Task,
    context: ContextSnapshot,
    set: RequirementSet,
  ): void;
  completeAnalysis(
    task: Task,
    context: ContextSnapshot,
    report: AnalysisReport,
  ): void;
}
export interface RepositoryAdapter {
  inspect(
    binding: RepositoryBinding,
    signal?: AbortSignal,
  ): Promise<RepositoryInspection>;
  assertReady(inspection: RepositoryInspection): void;
  synchronize(
    binding: RepositoryBinding,
    signal: AbortSignal,
  ): Promise<RepositorySnapshot>;
}
