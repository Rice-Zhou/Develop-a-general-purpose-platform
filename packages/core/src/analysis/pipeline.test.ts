import {AppError} from "../../../contracts/src/error";
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

it("returns each failed tool result without consuming final output repair", async () => {
  let calls = 0;
  const progress: string[] = [];
  const model = {
    version: "fixture",
    identity: {profileId:"test",kind:"api" as const,name:"test",configuredModel:"fixture",location:"local",configurationHash:"0".repeat(64)},
    complete: async (messages: import("./ports").ModelMessage[]) => {
      if (++calls === 1) return {content:null,toolCalls:[
        {id:"bad",name:"readDocumentBlock",arguments:JSON.stringify({documentSnapshotId:"d",blockId:"missing"})},
        {id:"denied",name:"readCode",arguments:JSON.stringify({bindingId:"repo",path:"../../secret",startLine:1,endLine:1})},
        {id:"schema",name:"readCode",arguments:JSON.stringify({path:"file"})},
        {id:"json",name:"readCode",arguments:"{"},
        {id:"good",name:"readDocumentBlock",arguments:JSON.stringify({documentSnapshotId:"d",blockId:"block"})},
      ]};
      const results = messages.filter(m => m.role === "tool");
      expect(results.map(m => m.tool_call_id)).toEqual(["bad", "denied", "schema", "json", "good"]);
      expect(JSON.parse(results[0].content!)).toMatchObject({error:{code:"BLOCK_NOT_FOUND"}});
      expect(JSON.parse(results[1].content!)).toMatchObject({error:{code:"PATH_DENIED"}});
      expect(JSON.parse(results[2].content!)).toMatchObject({error:{code:"INVALID_ARGUMENTS"}});
      expect(JSON.parse(results[3].content!)).toMatchObject({error:{code:"INVALID_ARGUMENTS"}});
      const id = JSON.parse(results[4].content!).evidence.id;
      // A genuine final-output failure must still have its separate repair available.
      return {content:JSON.stringify({items:[{text:"Requirement",acceptanceCriteria:[],sourceEvidenceIds:[calls===2?"invented":id],clarification:""}]})};
    },
  };
  const pipeline = new AnalysisPipeline(reader(),new SearchService({replaceSearchChunks(){},searchChunks(){return [];}}),new RequirementService({saveRequirementSet(){},latestRequirementSet(){return null;}}),model,message=>progress.push(message));
  await expect(pipeline.extract(0,new AbortController().signal)).resolves.toMatchObject({items:[{text:"Requirement"}]});
  expect(calls).toBe(3);
  expect(progress.filter(message=>message.includes("正在请求一次修正"))).toHaveLength(1);
  expect(progress.some(message=>message.includes("BLOCK_NOT_FOUND"))).toBe(true);
});
it("preserves the concrete final validation failure without recording raw model output",async()=>{
  const progress:string[]=[];
  const model={version:"fixture",identity:{profileId:"test",kind:"api" as const,name:"test",configuredModel:"fixture",location:"local",configurationHash:"0".repeat(64)},complete:async()=>({content:JSON.stringify({items:[{text:"private-model-text",acceptanceCriteria:[],sourceEvidenceIds:["invented"],clarification:""}]})})};
  const pipeline=new AnalysisPipeline(reader(),new SearchService({replaceSearchChunks(){},searchChunks(){return [];}}),new RequirementService({saveRequirementSet(){},latestRequirementSet(){return null;}}),model,message=>progress.push(message));
  await expect(pipeline.extract(0,new AbortController().signal)).rejects.toMatchObject({code:"OUTPUT_INVALID",message:expect.stringContaining("需求引用了不存在的原文证据")});
  expect(progress.join(" ")).toContain("需求引用了不存在的原文证据");
  expect(progress.join(" ")).not.toContain("private-model-text");
});

it.each(["CANCELLED", "CONTENT_CORRUPTED", "UNEXPECTED"])("does not repair fatal tool failure %s",async code=>{
  let calls=0;
  const r=reader();
  const failure=code==="UNEXPECTED"?new Error("storage failed"):new AppError(code,"unavailable");
  const model={version:"fixture",identity:{profileId:"test",kind:"api" as const,name:"test",configuredModel:"fixture",location:"local",configurationHash:"0".repeat(64)},complete:async()=>{
    calls++;
    r.readBlock=()=>{throw failure;};
    return {content:null,toolCalls:[{id:"read",name:"readDocumentBlock",arguments:JSON.stringify({documentSnapshotId:"d",blockId:"block"})}]};
  }};
  const pipeline=new AnalysisPipeline(r,new SearchService({replaceSearchChunks(){},searchChunks(){return [];}}),new RequirementService({saveRequirementSet(){},latestRequirementSet(){return null;}}),model);
  await expect(pipeline.extract(0,new AbortController().signal)).rejects.toBe(failure);
  expect(calls).toBe(1);
});
