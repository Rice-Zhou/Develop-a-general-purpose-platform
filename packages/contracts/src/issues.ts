import { z } from "zod";
import { EvidenceRefSchema, ExecutorIdentitySchema } from "./analysis";
import type { Project } from "./models";
export const ISSUE_REFRESH_TIMEOUT_MS = 5 * 60 * 1000;
const JIRA_COMPLETED_STATUSES = new Set(["完成", "已完成", "done", "completed"]);
export function isIssueStatusIndexed(platform: IssueConnectionDraft["platform"], status: string): boolean {
  return platform === "trinity" || !JIRA_COMPLETED_STATUSES.has(status.trim().toLowerCase());
}
export const JIRA_DISCOVERY_TIMEOUT_MS = 120000;
export interface JiraCatalogue {
  owner: string;
  projects: { key: string; name: string }[];
  issueTypes: { id: string; name: string }[];
  typeSource: "server" | "cli-config";
}
const atom = z.string().trim().min(1).max(2048);
export const JiraConnectionProjectSchema = z.object({ key: atom, name: atom, owner: atom, issueTypeIds: z.array(atom).min(1).max(50) }).strict();
const jiraProject = JiraConnectionProjectSchema.optional();
const base = {
  name: atom,
  baseUrl: z.url(),
  bypassProxy: z.boolean().default(true),
};
export const IssueConnectionDraftSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...base,
      kind: z.literal("jira-cli"),
      jiraProject,
      platform: z.enum(["jira-cloud", "jira-dc"]),
      executable: atom,
      configFile: atom,
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal("jira-http"),
      jiraProject,
      platform: z.literal("jira-dc"),
      username: atom.refine((value) => !/[\r\n:]/.test(value), "账号格式无效"),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal("trinity"),
      platform: z.literal("trinity"),
      username: atom.optional(),
      accountId: atom.optional(),
    })
    .strict(),
]);
export type IssueConnectionDraft = z.infer<typeof IssueConnectionDraftSchema>;
export type IssueConnection = IssueConnectionDraft & {
  id: string;
  credentialRef: string | null;
};
export type PublicIssueConnection = IssueConnectionDraft & {
  id: string;
  hasCredential: boolean;
};
export interface LocalJiraConfiguration {
  available: boolean;
  executable: string;
  configFile: string;
  baseUrl: string;
  username: string;
  platform: "jira-cloud" | "jira-dc" | null;
  detail: string;
}
export const RemoteIssueSchema = z
  .object({
    remoteId: atom,
    workitemId: atom.optional(),
    key: atom,
    instanceUrl: z.url(),
    remoteProjectId: atom,
    ownerId: atom,
    typeId: atom,
    title: z.string().min(1).max(10000),
    description: z.string().max(200000),
    status: atom,
    updatedAt: atom,
    versions: z.array(z.string().max(2000)).max(100),
    comments: z
      .array(z.object({ id: atom, text: z.string().max(100000) }).strict())
      .max(500),
    attachments: z
      .array(
        z
          .object({
            id: atom,
            name: atom,
            mediaType: z.string().max(200),
            size: z.number().nonnegative(),
          })
          .strict(),
      )
      .max(500),
    warnings: z.array(z.string().max(3000)).max(1000),
  })
  .strict();
export type RemoteIssue = z.infer<typeof RemoteIssueSchema>;
export const IssueSnapshotSchema = RemoteIssueSchema.extend({
  schemaVersion: z.literal(1),
  id: z.uuid(),
  projectId: z.string(),
  bindingId: z.string(),
  connectionId: z.string(),
  scopeHash: z.string(),
  contentHash: z.string(),
  fetchedAt: z.string(),
}).strict();
export type IssueSnapshot = z.infer<typeof IssueSnapshotSchema>;
export interface IssueScope {
  projectId: string;
  enabled: boolean;
  binding: Project["issueBindings"][number];
  connection: IssueConnection;
}
const statement = z
  .object({
    text: z.string().min(1).max(20000),
    evidenceIds: z.array(z.string()).max(100),
  })
  .strict();
export const BugProposalSchema = z
  .object({
    reproduction: z.array(z.string().min(1).max(10000)).max(50),
    facts: z.array(statement).max(100),
    hypotheses: z
      .array(
        z
          .object({
            text: z.string().min(1).max(20000),
            supportEvidenceIds: z.array(z.string()).max(100),
            counterEvidenceIds: z.array(z.string()).max(100),
            nextSteps: z.array(z.string().min(1).max(10000)).min(1).max(30),
          })
          .strict(),
      )
      .max(50),
    missingInformation: z.array(z.string().min(1).max(10000)).max(100),
  })
  .strict();
export const BugReportSchema = BugProposalSchema.extend({
  schemaVersion: z.literal(1),
  id: z.uuid(),
  projectId: z.string(),
  taskId: z.string(),
  attemptId: z.string(),
  contextSnapshotId: z.string(),
  issueSnapshotId: z.string(),
  createdAt: z.string(),
  executorVersion: z.string(),
  executorConfiguration: ExecutorIdentitySchema,
  templateVersion: z.literal("bugs-1"),
  evidenceRefs: z.array(EvidenceRefSchema),
  checkedScope: z.array(z.string()),
  limitations: z.array(z.string()),
  verification: z.literal("STATIC_PRELIMINARY"),
  usage: z
    .object({ inputTokens: z.number(), outputTokens: z.number() })
    .nullable(),
}).strict();
export type BugReport = z.infer<typeof BugReportSchema>;
