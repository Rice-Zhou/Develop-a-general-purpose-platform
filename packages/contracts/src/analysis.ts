import { z } from "zod";
import { WarningSchema } from "./documents";
export const AIProxyUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        ["http:", "https:"].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        url.pathname === "/"
      );
    } catch {
      return false;
    }
  }, "代理必须为不含账号、密码、查询参数的 HTTP(S) 地址");
const common = {
  name: z.string().trim().min(1).max(100),
  model: z.string().max(200),
  outboundEnabled: z.boolean(),
  proxyUrl: AIProxyUrlSchema.optional(),
};
export const AIProfileDraftSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...common,
      kind: z.literal("api"),
      baseUrl: z.url(),
      model: z.string().trim().min(1).max(200),
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal("codex"),
      executable: z.string().min(1),
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal("claude"),
      executable: z.string().min(1),
    })
    .strict(),
]);
export type AIProfileDraft = z.infer<typeof AIProfileDraftSchema>;
export type AIProfile = AIProfileDraft & {
  id: string;
  credentialRef: string | null;
};
export type PublicAIProfile = AIProfileDraft & {
  id: string;
  hasCredential: boolean;
};
export interface ExecutorDiagnostic {
  available: boolean;
  detail: string;
}
export const EvidenceRefSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("code"),
      id: z.string(),
      projectId: z.string(),
      contextSnapshotId: z.string(),
      bindingId: z.string(),
      commit: z.string(),
      path: z.string(),
      startLine: z.number().int().positive(),
      endLine: z.number().int().positive(),
      snippetHash: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("document"),
      id: z.string(),
      projectId: z.string(),
      contextSnapshotId: z.string(),
      documentSnapshotId: z.string(),
      blockId: z.string(),
      quoteHash: z.string(),
    })
    .strict(),
]);
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;
export interface SearchResult {
  method: "trigram" | "bounded-scan";
  results: { text: string; evidence: EvidenceRef | null; path?: string }[];
}
export const FindingSchema = z
  .object({
    requirementId: z.string(),
    status: z.enum([
      "IMPLEMENTED",
      "PARTIAL",
      "MISSING",
      "UNKNOWN",
      "CONFLICT",
    ]),
    explanation: z.string().min(1),
    evidenceIds: z.array(z.string()),
    checkedScope: z.array(z.string()).min(1),
    verification: z.literal("STATIC"),
  })
  .strict()
  .refine((f) => f.status === "UNKNOWN" || f.evidenceIds.length > 0, {
    message: "可确认结论必须引用证据",
  });
export const ExecutorIdentitySchema = z
  .object({
    profileId: z.string(),
    kind: z.enum(["api", "codex", "claude"]),
    name: z.string(),
    configuredModel: z.string().nullable(),
    location: z.string(),
    configurationHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type ExecutorIdentity = z.infer<typeof ExecutorIdentitySchema>;
export const AnalysisReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string(),
    projectId: z.string(),
    taskId: z.string(),
    attemptId: z.string(),
    contextSnapshotId: z.string(),
    requirementSetId: z.string(),
    inputSnapshotIds: z.array(z.string()),
    executorVersion: z.string(),
    executorConfiguration: ExecutorIdentitySchema,
    templateVersion: z.string(),
    createdAt: z.string(),
    findings: z.array(FindingSchema),
    evidenceRefs: z.array(EvidenceRefSchema),
    limitations: z.array(z.string()),
    sourceGaps: z.array(
      z.object({
        bindingId: z.string(),
        code: z.string(),
        message: z.string(),
        required: z.boolean(),
        affectedBlockIds: z.array(z.string()),
      }),
    ),
    parseWarnings: z.array(
      z
        .object({
          documentSnapshotId: z.string(),
          bindingId: z.string(),
          warnings: z.array(WarningSchema),
        })
        .strict(),
    ),
    usage: z
      .object({ inputTokens: z.number(), outputTokens: z.number() })
      .nullable(),
  })
  .strict();
export type Finding = z.infer<typeof FindingSchema>;
export type AnalysisReport = z.infer<typeof AnalysisReportSchema>;
export interface CliConfiguration {
  larkExecutable: string;
  identity: "user" | "bot";
}
