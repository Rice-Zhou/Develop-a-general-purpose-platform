import { z } from "zod";
import type { DocumentSnapshotRef, SourceGap } from "./documents";
import type { DocumentSnapshot } from "./documents";
import type { RequirementSet, RequirementItem } from "./requirements";
import type {
  IssueConnectionDraft,
  PublicIssueConnection,
  IssueSnapshot,
  BugReport,
} from "./issues";
import type { IssueMonitorConfiguration, IssueMonitorStatus, IssueWorkspace } from "./issue-monitor";
import type {
  AnalysisReport,
  AIProfileDraft,
  PublicAIProfile,
  CliConfiguration,
  EvidenceRef,
  ExecutorDiagnostic,
  SearchResult,
} from "./analysis";
const text = z.string().trim().min(1).max(2048);
export const RepositoryDraftSchema = z
  .object({
    path: text,
    remoteName: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
    branch: text,
    role: z.string().max(100).default("主仓库"),
  })
  .strict();
export const DocumentBindingSchema = z
  .object({
    id: z.string(),
    kind: z.enum(["docx", "pdf", "feishu"]),
    locator: text,
    required: z.boolean(),
  })
  .strict();
export const ProjectDocumentsUpdateSchema = z.object({
  projectId: z.uuid(),
  documents: z.array(DocumentBindingSchema).max(100),
  expectedRevision: z.number().int().positive(),
}).strict();
export const IssueBindingSchema = z
  .object({
    id: z.string(),
    platform: z.enum(["jira-cloud", "jira-dc", "trinity"]),
    instanceUrl: z.url(),
    projectKey: text,
    owner: text,
    connectionId: z.uuid().optional(),
    issueTypeIds: z.array(z.string().min(1).max(200)).min(1).max(50).optional(),
  })
  .strict();
export const ProjectDraftSchema = z
  .object({
    id: z.uuid().optional(),
    name: z.string().trim().min(1).max(100),
    enabled: z.boolean(),
    repositories: z.array(RepositoryDraftSchema).min(1).max(20),
    documents: ProjectDocumentsUpdateSchema.shape.documents,
    issueBindings: z.array(IssueBindingSchema).max(20).refine((items) => items.filter((b) => b.platform !== "trinity").length <= 1, "每个本地项目仅可选择单个 Jira 项目"),
    aiProfileId: z.string().nullable(),
  })
  .strict();
export type ProjectDraft = z.infer<typeof ProjectDraftSchema>;
export interface RepositoryBinding {
  id: string;
  canonicalPath: string;
  remoteName: string;
  branch: string;
  role: string;
  remoteUrlFingerprint: string | null;
}
export interface Project {
  id: string;
  name: string;
  enabled: boolean;
  revision: number;
  repositories: RepositoryBinding[];
  documents: z.infer<typeof DocumentBindingSchema>[];
  issueBindings: z.infer<typeof IssueBindingSchema>[];
  aiProfileId: string | null;
  updatedAt: string;
  deletedAt?: string;
}
export interface RepositoryBranch {
  canonicalPath: string;
  branch: string | null;
}
export interface RepositoryInspection {
  bindingId: string;
  branch: string;
  head: string;
  trackingRef: string;
  remoteUrlFingerprint: string;
  worktreeState: "clean" | "dirty";
  blockingReasons: string[];
}
export interface FileEntry {
  path: string;
  blob: string;
  mode: string;
}
export interface RepositorySnapshot {
  bindingId: string;
  canonicalPath: string;
  commit: string;
  branch: string;
  fetchedAt: string;
  remoteUrlFingerprint: string;
  fileManifestHash: string;
  files: FileEntry[];
  excluded: string[];
}
export interface ContextSnapshot {
  issueSnapshotId?: string;
  id: string;
  projectId: string;
  configRevision: number;
  repositories: RepositorySnapshot[];
  documents: DocumentSnapshotRef[];
  sourceGaps?: SourceGap[];
  createdAt: string;
  limitations: string[];
}
export const TaskStatusSchema = z.enum([
  "QUEUED",
  "PREPARING",
  "RUNNING",
  "VALIDATING",
  "SUCCEEDED",
  "WAITING_INPUT",
  "FAILED",
  "CANCELLING",
  "CANCELLED",
  "INTERRUPTED",
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export const ACTIVE_TASK_STATUSES: readonly TaskStatus[] = [
  "QUEUED",
  "PREPARING",
  "RUNNING",
  "VALIDATING",
  "CANCELLING",
];
export interface ErrorData {
  code: string;
  stage: string;
  message: string;
  retryable: boolean;
  requiredAction: string | null;
  diagnosticRef: string | null;
}
export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: ErrorData };
export interface Task {
  id: string;
  projectId: string;
  projectName: string;
  projectRevision?: number;
  executionConfigurationHash?: string;
  kind:
    | "PREPARE_CONTEXT"
    | "EXTRACT_REQUIREMENTS"
    | "CHECK_REQUIREMENTS"
    | "ANALYZE_BUG";
  issueSnapshotId?: string;
  attemptId?: string;
  requirementSetId?: string;
  resultId?: string;
  status: TaskStatus;
  attempt: number;
  createdAt: string;
  updatedAt: string;
  error: ErrorData | null;
  contextSnapshotId: string | null;
}
export interface TaskEvent {
  taskId: string;
  sequence: number;
  stage: string;
  message: string;
  timestamp: string;
}
export interface AppInfo {
  version: string;
  dataPath: string;
  gitAvailable: boolean;
  gitDiagnostic: string | null;
  capabilities: { name: string; available: boolean; reason: string }[];
}
export interface DesktopAPI {
  getJiraCatalogue(connectionId: string): Promise<Result<import("./issues").JiraCatalogue>>;
  getIssueConnections(): Promise<Result<PublicIssueConnection[]>>;
  inspectLocalJira(): Promise<
    Result<import("./issues").LocalJiraConfiguration>
  >;
  saveIssueConnection(
    draft: IssueConnectionDraft,
    secret?: string,
    id?: string,
  ): Promise<Result<PublicIssueConnection>>;
  deleteIssueConnection(id: string): Promise<Result<null>>;
  probeIssueConnection(
    projectId: string,
    bindingId: string,
  ): Promise<Result<ExecutorDiagnostic>>;
  getBugWorkspace(
    projectId: string,
  ): Promise<Result<IssueWorkspace & { reports: BugReport[] }>>;
  refreshBugWorkspace(projectId: string): Promise<Result<IssueWorkspace>>;
  getIssueMonitor(): Promise<Result<IssueMonitorStatus>>;
  saveIssueMonitor(configuration: IssueMonitorConfiguration): Promise<Result<IssueMonitorStatus>>;
  checkIssueNotifications(): Promise<Result<IssueMonitorStatus>>;
  refreshIssues(
    projectId: string,
    bindingId: string,
  ): Promise<Result<IssueSnapshot[]>>;
  readIssueByKey(
    projectId: string,
    bindingId: string,
    key: string,
  ): Promise<Result<IssueSnapshot[]>>;
  analyzeBug(projectId: string, issueSnapshotId: string): Promise<Result<Task>>;
  getBugReport(
    projectId: string,
    reportId: string,
  ): Promise<
    Result<{
      report: BugReport;
      issue: IssueSnapshot;
      context: ContextSnapshot;
    }>
  >;
  exportBugReport(
    projectId: string,
    reportId: string,
  ): Promise<Result<string | null>>;
  getReport(
    projectId: string,
    reportId: string,
  ): Promise<Result<{ report: AnalysisReport; requirements: RequirementSet }>>;
  readDocumentBlock(
    projectId: string,
    contextId: string,
    documentSnapshotId: string,
    blockId: string,
  ): Promise<
    Result<{
      text: string;
      evidence: Extract<EvidenceRef, { kind: "document" }>;
    }>
  >;
  getWorkspace(projectId: string): Promise<
    Result<{
      context: ContextSnapshot | null;
      documents: DocumentSnapshot[];
      requirements: RequirementSet | null;
      reports: AnalysisReport[];
    }>
  >;
  saveRequirementRevision(
    projectId: string,
    contextId: string,
    items: RequirementItem[],
    expectedRevision: number,
  ): Promise<Result<RequirementSet>>;
  extractRequirements(projectId: string): Promise<Result<Task>>;
  checkRequirements(
    projectId: string,
    requirementSetId: string,
  ): Promise<Result<Task>>;
  searchEvidence(
    projectId: string,
    contextId: string,
    query: string,
  ): Promise<Result<SearchResult>>;
  readEvidence(
    projectId: string,
    contextId: string,
    evidence: EvidenceRef,
  ): Promise<Result<{ text: string; evidence: EvidenceRef }>>;
  getAIProfiles(): Promise<Result<PublicAIProfile[]>>;
  saveAIProfile(
    draft: AIProfileDraft,
    secret?: string,
    id?: string,
  ): Promise<Result<PublicAIProfile>>;
  deleteAIProfile(id: string): Promise<Result<null>>;
  getCliConfiguration(): Promise<
    Result<
      CliConfiguration & {
        codexExecutable: string;
        claudeExecutable: string;
        jiraExecutable: string;
        jiraConfigFile: string;
      }
    >
  >;
  saveCliConfiguration(
    configuration: CliConfiguration,
  ): Promise<Result<CliConfiguration>>;
  probeExecutor(id: string): Promise<Result<ExecutorDiagnostic>>;
  probeFeishu(): Promise<Result<ExecutorDiagnostic>>;
  chooseDocumentFiles(): Promise<Result<string[]>>;
  exportReport(
    projectId: string,
    reportId: string,
  ): Promise<Result<string | null>>;
  listProjects(): Promise<Result<Project[]>>;
  saveProjectDocuments(projectId: string, documents: Project["documents"], expectedRevision: number): Promise<Result<Project>>;
  saveProject(
    draft: ProjectDraft,
    expectedRevision?: number,
  ): Promise<Result<Project>>;
  deleteProject(
    projectId: string,
    expectedRevision: number,
  ): Promise<Result<void>>;
  openIssue(projectId: string, issueSnapshotId: string): Promise<Result<void>>;
  inspectRepository(
    binding: RepositoryBinding,
  ): Promise<Result<RepositoryInspection>>;
  readCurrentBranch(path: string): Promise<Result<RepositoryBranch>>;
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
