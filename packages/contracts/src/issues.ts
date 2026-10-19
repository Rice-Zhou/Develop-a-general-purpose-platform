import { z } from "zod";
import { EvidenceRefSchema, ExecutorIdentitySchema } from "./analysis";
import type { Project } from "./models";
const atom = z.string().trim().min(1).max(2048);
const base = {
  name: atom,
  baseUrl: z.url(),
  bypassProxy: z.boolean().default(false),
};
export const IssueConnectionDraftSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...base,
      kind: z.literal("jira-cli"),
      platform: z.enum(["jira-cloud", "jira-dc"]),
      executable: atom,
      configFile: atom,
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal("trinity"),
      platform: z.literal("trinity"),
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
export const RemoteIssueSchema = z
  .object({
    remoteId: atom,
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
