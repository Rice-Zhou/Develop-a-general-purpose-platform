import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { EvidenceValidator } from "./evidence-validator";
import { ContextReader } from "../context/context-reader";
import type { ContextSnapshot } from "../../../contracts/src/models";
import type { DocumentSnapshot } from "../../../contracts/src/documents";
import { AnalysisPipeline } from "./analysis-pipeline";
import { SearchService } from "../search/search-service";
import { RequirementService } from "../requirements/requirement-service";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const context: ContextSnapshot = {
  id: "c",
  projectId: "p",
  configRevision: 1,
  repositories: [],
  documents: [
    { id: "d", bindingId: "b", contentHash: hash("raw"), kind: "docx" },
  ],
  createdAt: "now",
  limitations: [],
};
const document: DocumentSnapshot = {
  schemaVersion: 1,
  id: "d",
  projectId: "p",
  bindingId: "b",
  kind: "docx",
  contentHash: hash("raw"),
  sourceLocator: "file.docx",
  sourceRevision: null,
  parserVersion: "test",
  fetchedAt: "now",
  blocks: [
    {
      id: "block",
      kind: "paragraph",
      text: "必须校验密码",
      headingPath: [],
      anchor: { label: "段落 1" },
      warnings: [],
    },
  ],
  warnings: [],
};
function reader() {
  return new ContextReader(
    context,
    {
      getDocument: (projectId) => {
        if (projectId !== "p") throw new Error("scope");
        return document;
      },
    },
    { readFile: async () => Buffer.from("code") },
    { get: async () => Buffer.from("raw") },
  );
}
it("rejects fabricated or cross-context evidence", async () => {
  const r = reader();
  const ref = r.readBlock("d", "block").evidence;
  await expect(
    new EvidenceValidator().validate([ref], r),
  ).resolves.toBeUndefined();
  await expect(
    new EvidenceValidator().validate([{ ...ref, projectId: "other" }], r),
  ).rejects.toMatchObject({ code: "EVIDENCE_INVALID" });
  await expect(
    new EvidenceValidator().validate(
      [{ ...ref, quoteHash: "0".repeat(64) }],
      r,
    ),
  ).rejects.toMatchObject({ code: "EVIDENCE_INVALID" });
});
it("repairs invalid output once and refuses invented source IDs after that", async () => {
  let calls = 0;
  const r = reader();
  const search = new SearchService({
    replaceSearchChunks: () => {},
    searchChunks: () => [],
  });
  const reqs = new RequirementService({
    saveRequirementSet: () => {},
    latestRequirementSet: () => null,
  });
  const model = {
    version: "test",
    identity: {
      profileId: "test",
      kind: "api" as const,
      name: "test",
      configuredModel: "fixture",
      location: "http://127.0.0.1",
      configurationHash: "0".repeat(64),
    },
    complete: async () => {
      calls++;
      return {
        content:
          '{"items":[{"text":"需求","acceptanceCriteria":[],"sourceEvidenceIds":["invented"],"clarification":""}]}',
      };
    },
  };
  const pipeline = new AnalysisPipeline(r, search, reqs, model);
  await expect(
    pipeline.extract(0, new AbortController().signal),
  ).rejects.toMatchObject({ code: "OUTPUT_INVALID" });
  expect(calls).toBe(2);
});
it("marks affected conclusions unknown when source coverage is incomplete and preserves the source citation", async () => {
  const loss = {
    ...document,
    blocks: document.blocks.map((block) => ({
      ...block,
      warnings: [
        {
          code: "IMAGE_NOT_PARSED",
          message: "需求图片未解析",
          blockId: block.id,
        },
      ],
    })),
  };
  const r = new ContextReader(
    context,
    { getDocument: () => loss },
    { readFile: async () => Buffer.from("code") },
    { get: async () => Buffer.from("raw") },
  );
  const source = r.readBlock("d", "block").evidence;
  const model = {
    version: "fixture",
    identity: {
      profileId: "test",
      kind: "api" as const,
      name: "fixture",
      configuredModel: "model",
      location: "http://127.0.0.1",
      configurationHash: "0".repeat(64),
    },
    complete: async () => ({
      content: JSON.stringify({
        findings: [
          {
            requirementId: "req",
            status: "IMPLEMENTED",
            explanation: "模型声称已实现",
            evidenceIds: [],
          },
        ],
      }),
    }),
  };
  const requirements = new RequirementService({
    saveRequirementSet: () => {},
    latestRequirementSet: () => null,
  });
  const pipeline = new AnalysisPipeline(
    r,
    new SearchService({
      replaceSearchChunks: () => {},
      searchChunks: () => [],
    }),
    requirements,
    model,
  );
  const report = await pipeline.check(
    {
      id: "task",
      projectId: "p",
      projectName: "P",
      kind: "CHECK_REQUIREMENTS",
      attemptId: "attempt",
      status: "RUNNING",
      attempt: 1,
      createdAt: "now",
      updatedAt: "now",
      contextSnapshotId: null,
      error: null,
    },
    {
      schemaVersion: 1,
      id: "set",
      projectId: "p",
      contextSnapshotId: "c",
      revision: 1,
      createdAt: "now",
      items: [
        {
          id: "req",
          text: "密码验证",
          acceptanceCriteria: ["密码为空时拒绝"],
          sourceRefs: [
            {
              documentSnapshotId: "d",
              blockId: "block",
              quoteHash: source.quoteHash,
            },
          ],
          clarification: "",
          reviewed: true,
        },
      ],
    },
    new AbortController().signal,
  );
  expect(report.findings[0].status).toBe("UNKNOWN");
  expect(report.findings[0].evidenceIds).toContain(source.id);
  expect(report.usage).toBeNull();
});
