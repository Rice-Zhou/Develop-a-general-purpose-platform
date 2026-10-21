import { z } from "zod";
import type {CodexDiscovery} from "./codex";
import type { DocumentSnapshotRef, SourceGap } from "./documents";
import type { DocumentSnapshot } from "./documents";
import type { RequirementSet, RequirementItem } from "./requirements";
import type {
  IssueConnectionDraft,
  PublicIssueConnection,
  IssueSnapshot,
  BugReport,
} from "./issues";
import type { IssueMonitorConfiguration, IssueMonitorStatus, IssueWorkspace, NotificationRecipientSearch } from "./issue-monitor";
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
export const DocumentResourceDraftSchema = DocumentBindingSchema.omit({ id: true }).extend({ id: z.string().min(1).optional(), name: text });
export type DocumentResource = z.infer<typeof DocumentBindingSchema> & { name: string; revision: number };
export const IssueBindingSchema = z
  .object({
    id: z.string(),
    platform: z.enum(["jira-cloud", "jira-dc", "trinity"]),
    instanceUrl: z.url(),
    scopeMode: z.literal("account").optional(),
    projectKey: text,
    owner: text,
    connectionId: z.uuid().optional(),
    issueTypeIds: z.array(z.string().min(1).max(200)).min(1).max(50).optional(),
  })
  .strict();
export const TrinityProjectMappingSchema = z.object({ instanceUrl: z.url(), projectId: text, name: text.optional() }).strict();
export const ProjectDraftSchema = z
  .object({
    id: z.uuid().optional(),
    name: z.string().trim().min(1).max(100),
    enabled: z.boolean(),
    repositories: z.array(RepositoryDraftSchema).min(1).max(20),
    documents: ProjectDocumentsUpdateSchema.shape.documents,
    issueBindings: z.array(IssueBindingSchema).max(20).refine((items) => items.filter((b) => b.platform !== "trinity").length <= 1, "每个本地项目仅可选择单个 Jira 项目"),
    trinityProjects: z.array(TrinityProjectMappingSchema).max(100).optional(),
    aiProfileId: z.string().nullable(),
    usesDefaultAI: z.boolean().optional(),
  })
  .strict();
export type ProjectDraft = z.infer<typeof ProjectDraftSchema>;
export const ProjectLinksUpdateSchema = z.object({ projectId: z.uuid(), expectedRevision: z.number().int().positive(), documents: ProjectDraftSchema.shape.documents, issueBindings: ProjectDraftSchema.shape.issueBindings, trinityProjects: ProjectDraftSchema.shape.trinityProjects, aiProfileId: ProjectDraftSchema.shape.aiProfileId, usesDefaultAI: ProjectDraftSchema.shape.usesDefaultAI }).strict();
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
  trinityProjects?: z.infer<typeof TrinityProjectMappingSchema>[];
  usesDefaultAI?: boolean;
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
export interface GitRepositorySnapshot {
  kind?: "git";
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
export interface WorktreeRepositorySnapshot {
  kind: "worktree";
  bindingId:string;
  canonicalPath:string;
  commit:string|null;
  branch:string|null;
  capturedAt:string;
  manifestHash:string;
  dirty:boolean;
  files:{path:string;contentHash:string;size:number}[];
  excluded:string[];
}
export type RepositorySnapshot = GitRepositorySnapshot | WorktreeRepositorySnapshot;
export interface ContextSnapshot {
  issueLogs?:import("./issue-materials").IssueLogSetRef;
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
  deletedAt?:string;
  issueKey?:string;
  issueIdentity?:string;
  bugOptions?:import("./issue-materials").BugAnalysisOptions;
  id: string;
  projectId: string;
  projectName: string;
  projectRevision?: number;
  executionConfigurationHash?: string;
  kind:
    | "UPDATE_CODE"
    | "CONTINUE_CODE_UPDATE"
    | "RESOLVE_CODE_CONFLICTS"
    | "PREPARE_CONTEXT"
    | "EXTRACT_REQUIREMENTS"
    | "CHECK_REQUIREMENTS"
    | "ANALYZE_BUG"
    | "DOWNLOAD_ISSUE_LOGS";
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
  discoverJiraConnection(draft: IssueConnectionDraft, secret?: string): Promise<Result<import("./issues").JiraCatalogue>>;
  getTrinityProjects(connectionId: string): Promise<Result<NonNullable<Project["trinityProjects"]>>>;
  associateTrinityIssue(input: {projectId:string;issueSnapshotId:string;targetProjectId:string;expectedRevision:number}): Promise<Result<Project>>;
  getJiraCatalogue(connectionId: string): Promise<Result<import("./issues").JiraCatalogue>>;
  getTrinityLoginStatus(): Promise<Result<import("./issues").TrinityLoginStatus>>;
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
  ): Promise<Result<Omit<IssueWorkspace,"issues"> & {issues:import("./issue-monitor").BugWorkspaceIssue[]}>>;
  refreshBugWorkspace(projectId: string): Promise<Result<IssueWorkspace>>;
  getIssueMonitor(): Promise<Result<IssueMonitorStatus>>;
  saveIssueMonitor(configuration: IssueMonitorConfiguration): Promise<Result<IssueMonitorStatus>>;
  checkIssueNotifications(): Promise<Result<IssueMonitorStatus>>;
  searchNotificationRecipients(query: string): Promise<Result<NotificationRecipientSearch>>;
  saveNotificationRecipient(openId: string): Promise<Result<IssueMonitorStatus>>;
  refreshIssues(
    projectId: string,
    bindingId: string,
  ): Promise<Result<IssueSnapshot[]>>;
  readIssueByKey(
    projectId: string,
    bindingId: string,
    key: string,
  ): Promise<Result<IssueSnapshot[]>>;
  analyzeBug(input:{projectId:string;issueSnapshotId:string;targetProjectId?:string;options?:import("./issue-materials").BugAnalysisOptions}):Promise<Result<Task>>;
  retryIssueLogs(projectId:string,issueSnapshotId:string):Promise<Result<import("./issue-materials").IssueLogSet>>;
  openIssueMaterial(projectId:string,issueSnapshotId:string,fileId:string):Promise<Result<void>>;
  readIssueLog(projectId:string,issueSnapshotId:string,fileId:string):Promise<Result<{text:string;truncated:boolean}>>;
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
  getBugReportForTask(projectId:string,taskId:string):Promise<Result<import("./issues").BugReportView>>;
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
  discoverCodex(proxyUrl?: string): Promise<Result<CodexDiscovery>>;
  saveAIProfile(
    draft: AIProfileDraft,
    secret?: string,
    id?: string,
  ): Promise<Result<PublicAIProfile>>;
  deleteAIProfile(id: string, replacementId: string | null): Promise<Result<null>>;
  getCliConfiguration(): Promise<
    Result<
      CliConfiguration & {
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
  getDocumentResources(): Promise<Result<DocumentResource[]>>;
  saveDocumentResource(draft: z.infer<typeof DocumentResourceDraftSchema>, expectedRevision?: number): Promise<Result<DocumentResource>>;
  deleteDocumentResource(id: string, expectedRevision: number): Promise<Result<void>>;
  getDefaultAIProfile(): Promise<Result<string | null>>;
  setDefaultAIProfile(id: string): Promise<Result<void>>;
  saveProjectLinks(input: z.infer<typeof ProjectLinksUpdateSchema>): Promise<Result<Project>>;
  updateCode(projectId: string, mode?: "update" | "continue" | "ai"): Promise<Result<Task>>;
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
  deleteTask(taskId:string):Promise<Result<null>>;
  cancelTask(taskId: string): Promise<Result<Task>>;
  retryTask(taskId: string): Promise<Result<Task>>;
  chooseRepositoryDirectory(): Promise<Result<string | null>>;
  getAppInfo(): Promise<Result<AppInfo>>;
  backupDatabase(): Promise<Result<string | null>>;
}
