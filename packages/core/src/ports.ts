import type {
  ContextSnapshot,
  Project,
  RepositoryBinding,
  RepositoryInspection,
  RepositorySnapshot,
  Task,
  TaskEvent,
} from "../../contracts/src/models";
export interface ProjectRepository {
  listProjects(): Project[];
  getProject(id: string): Project;
  saveProject(project: Project, expectedRevision?: number): void;
}
export interface TaskRepository {
  listTasks(projectId?: string): Task[];
  getTask(id: string): Task;
  saveTask(task: Task): void;
  event(taskId: string, stage: string, message: string): void;
  taskEvents(id: string): TaskEvent[];
  completeTask(task: Task, context: ContextSnapshot): void;
  latestContext(projectId: string): ContextSnapshot | null;
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
