import { z } from 'zod';
const text = z.string().trim().min(1).max(2048);
export const RepositoryDraftSchema = z.object({ path: text, remoteName: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/), branch: text, role: z.string().max(100).default('主仓库') }).strict();
export const DocumentBindingSchema = z.object({ id: z.string(), kind: z.enum(['docx', 'pdf', 'feishu']), locator: text, required: z.boolean() }).strict();
export const IssueBindingSchema = z.object({ id: z.string(), platform: z.enum(['jira-cloud', 'jira-dc', 'trinity']), instanceUrl: z.url(), projectKey: text, owner: text }).strict();
export const ProjectDraftSchema = z.object({ id: z.uuid().optional(), name: z.string().trim().min(1).max(100), enabled: z.boolean(), repositories: z.array(RepositoryDraftSchema).min(1).max(20), documents: z.array(DocumentBindingSchema).max(100), issueBindings: z.array(IssueBindingSchema).max(20), aiProfileId: z.string().nullable() }).strict();
export type ProjectDraft = z.infer<typeof ProjectDraftSchema>;
export interface RepositoryBinding { id: string; canonicalPath: string; remoteName: string; branch: string; role: string; remoteUrlFingerprint: string | null }
export interface Project { id: string; name: string; enabled: boolean; revision: number; repositories: RepositoryBinding[]; documents: z.infer<typeof DocumentBindingSchema>[]; issueBindings: z.infer<typeof IssueBindingSchema>[]; aiProfileId: string | null; updatedAt: string }
export interface RepositoryInspection { bindingId: string; branch: string; head: string; trackingRef: string; remoteUrlFingerprint: string; worktreeState: 'clean' | 'dirty'; blockingReasons: string[] }
export interface FileEntry { path: string; blob: string; mode: string }
export interface RepositorySnapshot { bindingId: string; canonicalPath: string; commit: string; branch: string; fetchedAt: string; remoteUrlFingerprint: string; fileManifestHash: string; files: FileEntry[]; excluded: string[] }
export interface ContextSnapshot { id: string; projectId: string; configRevision: number; repositories: RepositorySnapshot[]; documents: never[]; createdAt: string; limitations: string[] }
export const TaskStatusSchema = z.enum(['QUEUED', 'PREPARING', 'SUCCEEDED', 'WAITING_INPUT', 'FAILED', 'CANCELLING', 'CANCELLED', 'INTERRUPTED']);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export interface ErrorData { code: string; stage: string; message: string; retryable: boolean; requiredAction: string | null; diagnosticRef: string | null }
export type Result<T> = { ok: true; value: T } | { ok: false; error: ErrorData };
export interface Task { id: string; projectId: string; projectName: string; kind: 'PREPARE_CONTEXT'; status: TaskStatus; attempt: number; createdAt: string; updatedAt: string; error: ErrorData | null; contextSnapshotId: string | null }
export interface TaskEvent { taskId: string; sequence: number; stage: string; message: string; timestamp: string }
export interface AppInfo { version: string; dataPath: string; gitAvailable: boolean; gitDiagnostic: string | null; capabilities: { name: string; available: boolean; reason: string }[] }
export interface DesktopAPI {
  listProjects(): Promise<Result<Project[]>>;
  saveProject(draft: ProjectDraft, expectedRevision?: number): Promise<Result<Project>>;
  inspectRepository(binding: RepositoryBinding): Promise<Result<RepositoryInspection>>;
  prepareContext(projectId: string): Promise<Result<Task>>;
  listTasks(projectId?: string): Promise<Result<Task[]>>;
  getTaskEvents(taskId: string): Promise<Result<TaskEvent[]>>;
  getContext(snapshotId: string): Promise<Result<ContextSnapshot>>;
  cancelTask(taskId: string): Promise<Result<Task>>;
  retryTask(taskId: string): Promise<Result<Task>>;
  chooseRepositoryDirectory(): Promise<Result<string | null>>;
  getAppInfo(): Promise<Result<AppInfo>>;
  backupDatabase(): Promise<Result<string | null>>;
}
