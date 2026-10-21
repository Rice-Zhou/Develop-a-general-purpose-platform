import { BugAnalysisOptionsSchema } from "./issue-materials";
import { z } from "zod";
import { AppError } from "./error";
import { ProjectDraftSchema, ProjectDocumentsUpdateSchema, ProjectLinksUpdateSchema, DocumentResourceDraftSchema } from "./models";
import { AIProfileDraftSchema, EvidenceRefSchema, AIProxyUrlSchema } from "./analysis";
import { RequirementItemSchema } from "./requirements";
import { IssueConnectionDraftSchema } from "./issues";
import { IssueMonitorConfigurationSchema, NotificationOpenIdSchema, RecipientQuerySchema } from "./issue-monitor";
const empty = z.object({}).strict();
const id = z.uuid();
const binding = z
  .object({
    id: z.string().min(1),
    canonicalPath: z.string().min(1),
    remoteName: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
    branch: z.string().min(1),
    role: z.string(),
    remoteUrlFingerprint: z.string().nullable(),
  })
  .strict();
const request = z.discriminatedUnion("method", [
  z.object({method:z.literal("discoverCodex"),params:z.object({proxyUrl:AIProxyUrlSchema.optional()}).strict()}).strict(),
  z.object({method:z.literal("discoverJiraConnection"),params:z.object({draft:IssueConnectionDraftSchema,secret:z.string().max(10000).optional()}).strict().refine(p=>p.draft.kind!=="trinity","此入口仅支持 Jira")}).strict(),
  z.object({ method: z.literal("saveProjectLinks"), params: ProjectLinksUpdateSchema }).strict(),
  ...(["getDocumentResources", "getDefaultAIProfile"] as const).map(method => z.object({ method: z.literal(method), params: empty }).strict()),
  z.object({ method: z.literal("saveDocumentResource"), params: z.object({ draft: DocumentResourceDraftSchema, expectedRevision: z.number().int().positive().optional() }).strict() }).strict(),
  z.object({ method: z.literal("deleteDocumentResource"), params: z.object({ id: z.string().min(1), expectedRevision: z.number().int().positive() }).strict() }).strict(),
  z.object({ method: z.literal("setDefaultAIProfile"), params: z.object({ id }).strict() }).strict(),
  z.object({ method: z.literal("updateCode"), params: z.object({ projectId: id, mode: z.enum(["update", "continue", "ai"]).default("update") }).strict() }).strict(),
  z.object({ method: z.literal("saveProjectDocuments"), params: ProjectDocumentsUpdateSchema }).strict(),
  z.object({ method: z.literal("refreshBugWorkspace"), params: z.object({ projectId: id }).strict() }).strict(),
  ...(["getIssueMonitor", "checkIssueNotifications"] as const).map(method => z.object({ method: z.literal(method), params: empty }).strict()),
  z.object({ method: z.literal("saveIssueMonitor"), params: z.object({ configuration: IssueMonitorConfigurationSchema }).strict() }).strict(),
  z.object({method:z.literal("searchNotificationRecipients"),params:z.object({query:RecipientQuerySchema}).strict()}).strict(),
  z.object({method:z.literal("saveNotificationRecipient"),params:z.object({openId:NotificationOpenIdSchema}).strict()}).strict(),
  z.object({method:z.literal("getTrinityProjects"),params:z.object({connectionId:id}).strict()}).strict(),
  z.object({method:z.literal("associateTrinityIssue"),params:z.object({projectId:id,issueSnapshotId:id,targetProjectId:id,expectedRevision:z.number().int().positive()}).strict()}).strict(),
  z.object({ method: z.literal("getJiraCatalogue"), params: z.object({ connectionId: id }).strict() }).strict(),
  z
    .object({
      method: z.literal("deleteProject"),
      params: z
        .object({
          projectId: id,
          expectedRevision: z.number().int().positive(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      method: z.literal("openIssue"),
      params: z.object({ projectId: id, issueSnapshotId: id }).strict(),
    })
    .strict(),
  z.object({ method: z.literal("inspectLocalJira"), params: empty }).strict(),
  z
    .object({ method: z.literal("getIssueConnections"), params: empty })
    .strict(),
  z
    .object({
      method: z.literal("saveIssueConnection"),
      params: z
        .object({
          draft: IssueConnectionDraftSchema,
          secret: z.string().max(10000).optional(),
          id: id.optional(),
        })
        .strict()
        .refine(
          (p) => p.draft.kind !== "jira-cli" || !p.secret,
          "Jira 登录由 CLI 管理，不接受密钥",
        ),
    })
    .strict(),
  z
    .object({
      method: z.literal("deleteIssueConnection"),
      params: z.object({ id }).strict(),
    })
    .strict(),
  z
    .object({
      method: z.literal("getBugWorkspace"),
      params: z.object({ projectId: id }).strict(),
    })
    .strict(),
  ...(["probeIssueConnection", "refreshIssues"] as const).map((method) =>
    z
      .object({
        method: z.literal(method),
        params: z
          .object({ projectId: id, bindingId: z.string().min(1).max(200) })
          .strict(),
      })
      .strict(),
  ),
  z
    .object({
      method: z.literal("readIssueByKey"),
      params: z
        .object({
          projectId: id,
          bindingId: z.string().min(1).max(200),
          key: z.string().min(1).max(200),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      method: z.literal("analyzeBug"),
      params: z.object({ projectId: id, issueSnapshotId: id, targetProjectId: id.optional(), options:BugAnalysisOptionsSchema.optional() }).strict(),
    })
    .strict(),
  z.object({method:z.literal("retryIssueLogs"),params:z.object({projectId:id,issueSnapshotId:id}).strict()}).strict(),
  ...(["readIssueLog","openIssueMaterial"] as const).map(method=>z.object({method:z.literal(method),params:z.object({projectId:id,issueSnapshotId:id,fileId:z.string().min(1).max(200)}).strict()}).strict()),
  ...(["getBugReport", "exportBugReport"] as const).map((method) =>
    z
      .object({
        method: z.literal(method),
        params: z.object({ projectId: id, reportId: id }).strict(),
      })
      .strict(),
  ),
  z
    .object({
      method: z.literal("getReport"),
      params: z.object({ projectId: id, reportId: id }).strict(),
    })
    .strict(),
  z
    .object({
      method: z.literal("readDocumentBlock"),
      params: z
        .object({
          projectId: id,
          contextId: id,
          documentSnapshotId: id,
          blockId: z.string().min(1).max(2048),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      method: z.literal("getWorkspace"),
      params: z.object({ projectId: id }).strict(),
    })
    .strict(),
  z
    .object({
      method: z.literal("saveRequirementRevision"),
      params: z
        .object({
          projectId: id,
          contextId: id,
          items: z.array(RequirementItemSchema).max(500),
          expectedRevision: z.number().int().nonnegative(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      method: z.literal("extractRequirements"),
      params: z.object({ projectId: id }).strict(),
    })
    .strict(),
  z
    .object({
      method: z.literal("checkRequirements"),
      params: z.object({ projectId: id, requirementSetId: id }).strict(),
    })
    .strict(),
  z
    .object({
      method: z.literal("searchEvidence"),
      params: z
        .object({
          projectId: id,
          contextId: id,
          query: z.string().trim().min(1).max(200),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      method: z.literal("readEvidence"),
      params: z
        .object({ projectId: id, contextId: id, evidence: EvidenceRefSchema })
        .strict(),
    })
    .strict(),
  z
    .object({
      method: z.literal("saveAIProfile"),
      params: z
        .object({
          draft: AIProfileDraftSchema,
          secret: z.string().max(10000).optional(),
          id: id.optional(),
        })
        .strict()
        .refine(
          (p) => p.draft.kind === "api" || !p.secret,
          "订阅工具不接受 API 密钥",
        ),
    })
    .strict(),
  ...(["deleteAIProfile", "probeExecutor"] as const).map((method) =>
    z
      .object({ method: z.literal(method), params: z.object({ id }).strict() })
      .strict(),
  ),
  z
    .object({
      method: z.literal("saveCliConfiguration"),
      params: z
        .object({
          configuration: z
            .object({
              larkExecutable: z.string().max(2048),
              identity: z.enum(["user", "bot"]),
            })
            .strict(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      method: z.literal("exportReport"),
      params: z.object({ projectId: id, reportId: id }).strict(),
    })
    .strict(),
  z.object({ method: z.literal("listProjects"), params: empty }).strict(),
  z
    .object({
      method: z.literal("saveProject"),
      params: z
        .object({
          draft: ProjectDraftSchema,
          expectedRevision: z.number().int().positive().optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      method: z.literal("inspectRepository"),
      params: z.object({ binding }).strict(),
    })
    .strict(),
  z
    .object({
      method: z.literal("readCurrentBranch"),
      params: z.object({ path: z.string().trim().min(1).max(32768) }).strict(),
    })
    .strict(),
  z
    .object({
      method: z.literal("prepareContext"),
      params: z.object({ projectId: id }).strict(),
    })
    .strict(),
  z
    .object({
      method: z.literal("listTasks"),
      params: z.object({ projectId: id.optional() }).strict(),
    })
    .strict(),
  ...(["getTaskEvents", "cancelTask", "retryTask"] as const).map((method) =>
    z
      .object({
        method: z.literal(method),
        params: z.object({ taskId: id }).strict(),
      })
      .strict(),
  ),
  z
    .object({
      method: z.literal("getContext"),
      params: z.object({ snapshotId: id }).strict(),
    })
    .strict(),
  ...(
    [
      "chooseRepositoryDirectory",
      "getAppInfo",
      "backupDatabase",
      "getAIProfiles",
      "getCliConfiguration",
      "probeFeishu",
      "chooseDocumentFiles",
    ] as const
  ).map((method) =>
    z.object({ method: z.literal(method), params: empty }).strict(),
  ),
]);
export type Request = z.infer<typeof request>;
export function parseRequest(input: unknown): Request {
  const parsed = request.safeParse(input);
  if (!parsed.success)
    throw new AppError(
      "INVALID_REQUEST",
      parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join(";"),
      "ipc",
    );
  return parsed.data;
}
export function assertTrustedSender(
  senderId: number,
  windowId: number,
  mainFrame: boolean,
): void {
  if (senderId !== windowId || !mainFrame)
    throw new AppError("UNTRUSTED_SENDER", "拒绝来自非应用主窗口的请求", "ipc");
}
