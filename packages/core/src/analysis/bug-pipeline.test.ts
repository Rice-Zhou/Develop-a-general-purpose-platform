import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { AnalysisPipeline } from "./analysis-pipeline";
import { ContextReader } from "../context/context-reader";
import { SearchService } from "../search/search-service";
import { RequirementService } from "../requirements/requirement-service";
import type { IssueSnapshot } from "../../../contracts/src/issues";
const issue: IssueSnapshot = {
  schemaVersion: 1,
  id: randomUUID(),
  projectId: "p",
  bindingId: "b",
  connectionId: "c",
  scopeHash: "s",
  contentHash: "h",
  fetchedAt: "now",
  remoteId: "1",
  key: "A-1",
  instanceUrl: "https://jira.example",
  remoteProjectId: "A",
  ownerId: "alice",
  typeId: "1",
  title: "空密码可以登录",
  description: "password empty",
  status: "Open",
  updatedAt: "now",
  versions: ["old-build"],
  comments: [],
  attachments: [],
  warnings: ["附件未解析"],
};
it.each([true, false, "empty", "unsupported", "missing"])(
  "validates BUG facts and retains hypotheses as preliminary (fabricated=%s)",
  async (fabricated) => {
    const reader = new ContextReader(
      {
        id: "ctx",
        projectId: "p",
        configRevision: 1,
        createdAt: "now",
        documents: [],
        repositories: [
          {
            bindingId: "r",
            canonicalPath: "D:/repo",
            commit: "a".repeat(40),
            branch: "main",
            fetchedAt: "now",
            remoteUrlFingerprint: "f",
            fileManifestHash: "m",
            files: [{ path: "login.ts", blob: "b", mode: "100644" }],
            excluded: [],
          },
        ],
        limitations: [],
        issueSnapshotId: issue.id,
      },
      {
        getDocument: () => {
          throw new Error("none");
        },
      },
      {
        readFile: async () => Buffer.from("export const login = () => true;\n"),
      },
      { get: async () => Buffer.from("") },
    );
    let round = 0;
    let evidenceId = "";
    const model = {
      version: "fixture",
      identity: {
        profileId: "m",
        kind: "api" as const,
        name: "m",
        configuredModel: "fixture",
        location: "http://127.0.0.1",
        configurationHash: "0".repeat(64),
      },
      complete: async (
        messages: { role: string; content: string | null }[],
      ) => {
        if (typeof fabricated === "string")
          return {
            content: JSON.stringify({
              reproduction: [],
              facts: [],
              hypotheses:
                fabricated === "unsupported"
                  ? [
                      {
                        text: "凭空猜测",
                        supportEvidenceIds: [],
                        counterEvidenceIds: [],
                        nextSteps: ["检查"],
                      },
                    ]
                  : [],
              missingInformation:
                fabricated === "missing" ? ["请提供故障版本和可定位代码"] : [],
            }),
          };
        if (round++ === 0)
          return {
            content: null,
            toolCalls: [
              {
                id: "read",
                name: "readCode",
                arguments: JSON.stringify({
                  bindingId: "r",
                  path: "login.ts",
                  startLine: 1,
                  endLine: 1,
                }),
              },
            ],
          };
        const tool = messages.find((m) => m.role === "tool");
        if (tool) evidenceId = JSON.parse(tool.content!).evidence.id;
        return {
          content: JSON.stringify({
            reproduction: ["空密码登录"],
            facts: [
              {
                text: "函数直接返回 true",
                evidenceIds: [fabricated ? "invented" : evidenceId],
              },
            ],
            hypotheses: [
              {
                text: "可能没有输入验证",
                supportEvidenceIds: [evidenceId],
                counterEvidenceIds: [],
                nextSteps: ["复测空密码分支"],
              },
            ],
            missingInformation: ["故障版本提交"],
          }),
        };
      },
    };
    const pipeline = new AnalysisPipeline(
      reader,
      new SearchService({
        replaceSearchChunks: () => {},
        searchChunks: () => [],
      }),
      new RequirementService({
        saveRequirementSet: () => {},
        latestRequirementSet: () => null,
      }),
      model,
    );
    const result = pipeline.preanalyze(
      {
        id: "t",
        projectId: "p",
        projectName: "P",
        kind: "ANALYZE_BUG",
        status: "RUNNING",
        attempt: 1,
        createdAt: "now",
        updatedAt: "now",
        error: null,
        contextSnapshotId: null,
      },
      issue,
      new AbortController().signal,
    );
    if (fabricated)
      await expect(result).rejects.toMatchObject({
        code:
          fabricated === "missing"
            ? "BUG_EVIDENCE_INSUFFICIENT"
            : "OUTPUT_INVALID",
      });
    else {
      const report = await result;
      expect(report.evidenceRefs).toHaveLength(1);
      expect(report.verification).toBe("STATIC_PRELIMINARY");
      expect(report.limitations.join(" ")).toContain("old-build");
      expect(report.limitations).toContain("附件未解析");
    }
  },
);
