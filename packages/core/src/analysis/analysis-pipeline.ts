import { isCodeEvidence } from "../../../contracts/src/analysis";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Task } from "../../../contracts/src/models";
import {
  type EvidenceRef,
  AnalysisReportSchema,
  type AnalysisReport,
} from "../../../contracts/src/analysis";
import type { RequirementSet } from "../../../contracts/src/requirements";
import { AppError } from "../../../contracts/src/error";
import { ContextReader } from "../context/context-reader";
import type { SearchService } from "../search/search-service";
import type { RequirementService } from "../requirements/requirement-service";
import type { ModelTransport, ModelMessage, ToolSpec } from "./ports";
import { SYSTEM_PROMPT, EXTRACTION_GOAL, CHECK_GOAL } from "./prompts";
import { EvidenceValidator } from "./evidence-validator";
import {
  BugProposalSchema,
  BugReportSchema,
  type BugReport,
  type IssueSnapshot,
} from "../../../contracts/src/issues";
const recoverableToolCodes = new Set([
  "OUTPUT_INVALID", "BLOCK_NOT_FOUND", "PATH_DENIED", "LINE_RANGE_DENIED",
  "REPOSITORY_DENIED", "DOCUMENT_DENIED", "LOG_DENIED", "BINARY_FILE",
  "TEXT_ENCODING_UNSUPPORTED", "TOOL_OUTPUT_LIMIT",
]);
function validationFailure(error: unknown): string | undefined {
  if (error instanceof z.ZodError) return ("INVALID_SCHEMA: " + error.issues.slice(0, 10)
    .map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ")).slice(0,1500);
  if (error instanceof SyntaxError) return "INVALID_JSON: 返回内容不是有效 JSON";
  if (error instanceof AppError && (recoverableToolCodes.has(error.code) || error.code === "EVIDENCE_INVALID"))
    return `${error.code}: ${error.message}`.slice(0,1500);
  return undefined;
}
const toolSchemas = {
  searchLogs:z.object({query:z.string().min(1).max(200),limit:z.number().int().min(1).max(20)}).strict(),
  readLog:z.object({logSetId:z.string(),fileId:z.string(),startLine:z.number().int().positive(),endLine:z.number().int().positive()}).strict(),
  searchEvidence: z
    .object({
      query: z.string().min(1).max(200),
      limit: z.number().int().min(1).max(20),
    })
    .strict(),
  readCode: z
    .object({
      bindingId: z.string(),
      path: z.string(),
      startLine: z.number().int().positive(),
      endLine: z.number().int().positive(),
    })
    .strict(),
  readDocumentBlock: z
    .object({ documentSnapshotId: z.string(), blockId: z.string() })
    .strict(),
};
const tools: ToolSpec[] = Object.entries(toolSchemas).map(([name, schema]) => ({
  type: "function",
  function: {
    name,
    description: "读取当前项目固定快照证据，不能读取任意路径",
    parameters: z.toJSONSchema(schema),
  },
}));
const extracted = z
  .object({
    items: z
      .array(
        z
          .object({
            text: z.string().min(1),
            acceptanceCriteria: z.array(z.string().min(1)),
            sourceEvidenceIds: z.array(z.string()).min(1),
            clarification: z.string(),
          })
          .strict(),
      )
      .max(500),
  })
  .strict();
const checked = z
  .object({
    findings: z
      .array(
        z
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
          })
          .strict(),
      )
      .max(500),
  })
  .strict();
export class AnalysisPipeline {
  private readonly evidence = new Map<string, EvidenceRef>();
  private readonly trace: string[] = [];
  private calls = 0;
  private usageKnown = true;
  private inputTokens = 0;
  private outputTokens = 0;
  constructor(
    private readonly reader: ContextReader,
    private readonly search: SearchService,
    private readonly requirements: RequirementService,
    private readonly model: ModelTransport,
    private readonly progress: (message: string) => void = () => {},
  ) {}
  private remember(ref: EvidenceRef): void {
    if (this.evidence.size >= 1000 && !this.evidence.has(ref.id))
      throw new AppError("EVIDENCE_BUDGET", "取证数量超过 1,000 条");
    this.evidence.set(ref.id, ref);
  }
  private initialMaterials(): object {
    let size = 0;
    const blocks = [];
    for (const ref of this.reader.context.documents)
      for (const block of this.reader.document(ref.id).blocks) {
        if (size >= 120000) break;
        const excerpt = this.reader.readBlock(ref.id, block.id);
        this.remember(excerpt.evidence);
        const text = excerpt.text.slice(0, 1000);
        size += text.length;
        blocks.push({
          text,
          truncated: excerpt.text.length > text.length,
          evidence: excerpt.evidence,
          warnings: block.warnings,
        });
      }
    return {
      contextId: this.reader.context.id,
      logs:this.reader.context.issueLogs ? {id:this.reader.logs().id,manifestHash:this.reader.logs().manifestHash,status:this.reader.logs().status,files:this.reader.logs().files.map(file=>({fileId:file.id,path:file.path,status:file.status,lineCount:file.lineCount,error:file.error})),searchCoverage:"搜索仅前 150 个文件前 100 行；readLog 可继续读取每次最多 400 行"} : null,
      blocks,
      paths: this.reader.context.repositories
        .flatMap((repo) =>
          repo.files.map((file) => ({
            bindingId: repo.bindingId,
            path: file.path,
          })),
        )
        .slice(0, 1000),
      limitations: [
        ...this.reader.context.limitations,
        "初始材料仅含最多 120,000 字符的块预览和 1,000 个路径；须通过工具继续取证，不能据此声称全量核对",
      ],
    };
  }
  private async tool(
    name: string,
    args: string,
    signal: AbortSignal,
  ): Promise<unknown> {
    const value = JSON.parse(args) as unknown;
    let result: unknown;
    if(name === "readLog") {
      const input=toolSchemas.readLog.parse(value);const excerpt=await this.reader.readLog(input.logSetId,input.fileId,input.startLine,input.endLine,signal);this.remember(excerpt.evidence);this.trace.push(`读取日志 ${input.fileId}:${input.startLine}-${input.endLine}`);result=excerpt;
    }else if(name === "searchLogs") {
      const input=toolSchemas.searchLogs.parse(value);const found=await this.reader.searchLogs(input.query,input.limit,signal);for(const row of found.results)this.remember(row.evidence);this.trace.push(`日志搜索 ${input.query}（受限范围，${found.results.length} 条）`);result=found;
    }else if (name === "searchEvidence") {
      const input = toolSchemas.searchEvidence.parse(value);
      const found = this.search.search(
        this.reader.context,
        input.query,
        input.limit,
      );
      for (const row of found.results)
        if (row.evidence) this.remember(row.evidence);
      result = found;
      this.trace.push(
        `搜索 ${input.query}（${found.method}，${found.results.length} 条）`,
      );
    } else if (name === "readCode") {
      const input = toolSchemas.readCode.parse(value);
      const excerpt = await this.reader.readCode(
        input.bindingId,
        input.path,
        input.startLine,
        input.endLine,
        signal,
      );
      if (excerpt.text.length > 32000)
        throw new AppError("TOOL_OUTPUT_LIMIT", "代码片段过长，请缩小读取范围");
      this.remember(excerpt.evidence);
      result = excerpt;
      this.trace.push(
        `${input.bindingId}:${input.path}:${input.startLine}-${input.endLine}`,
      );
    } else if (name === "readDocumentBlock") {
      const input = toolSchemas.readDocumentBlock.parse(value);
      const excerpt = this.reader.readBlock(
        input.documentSnapshotId,
        input.blockId,
      );
      if (excerpt.text.length > 32000)
        throw new AppError("TOOL_OUTPUT_LIMIT", "原文块过长，需要人工拆分需求");
      this.remember(excerpt.evidence);
      result = excerpt;
      this.trace.push(`文档 ${input.documentSnapshotId}:${input.blockId}`);
    } else throw new AppError("OUTPUT_INVALID", "模型请求了未允许的工具");
    this.progress(`取证：${name}`);
    return result;
  }
  private async run(
    messages: ModelMessage[],
    signal: AbortSignal,
  ): Promise<unknown> {
    while (this.calls < 12) {
      if (signal.aborted) throw new AppError("CANCELLED", "分析已取消");
      this.calls++;
      this.progress(`模型请求 ${this.calls}/12`);
      const reply = await this.model.complete(messages, tools, signal);
      if (reply.usage) {
        this.inputTokens += reply.usage.inputTokens;
        this.outputTokens += reply.usage.outputTokens;
      } else this.usageKnown = false;
      if (reply.toolCalls?.length) {
        if (reply.toolCalls.length > 20)
          throw new AppError("OUTPUT_INVALID", "单轮取证工具数量超过限制");
        messages.push({
          role: "assistant",
          content: reply.content,
          tool_calls: reply.toolCalls.map((call) => ({
            id: call.id,
            type: "function",
            function: { name: call.name, arguments: call.arguments },
          })),
        });
        for (const call of reply.toolCalls) {
          let result: unknown;
          try {
            result = await this.tool(call.name, call.arguments, signal);
          } catch (error) {
            const reason = validationFailure(error);
            // Reply to every tool call so the model can correct its request without
            // consuming the one repair reserved for final report validation.
            if (!reason || (error instanceof AppError && !recoverableToolCodes.has(error.code))) throw error;
            result = {error: {code: error instanceof AppError ? error.code : "INVALID_ARGUMENTS", message: reason}};
            this.progress(`取证请求失败：${call.name} · ${reason}`);
          }
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(result),
          });
        }
        continue;
      }
      if (!reply.content)
        throw new AppError("OUTPUT_INVALID", "模型未返回结果");
      messages.push({ role: "assistant", content: reply.content });
      return JSON.parse(reply.content) as unknown;
    }
    throw new AppError(
      "MODEL_CALL_BUDGET",
      "已达到 12 次模型请求上限，未提交成功结果",
    );
  }
  private async corrected<T>(
    goal: string,
    input: unknown,
    signal: AbortSignal,
    validate: (value: unknown) => Promise<T> | T,
  ): Promise<T> {
    const messages: ModelMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: JSON.stringify({
          goal,
          input,
          materials: this.initialMaterials(),
        }),
      },
    ];
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await validate(await this.run(messages, signal));
      } catch (error) {
        const reason = validationFailure(error);
        if (!reason) throw error;
        if (attempt === 1)
          throw new AppError(
            "OUTPUT_INVALID",
            `模型输出或证据在一次修正后仍无效，未保存成功报告。具体原因：${reason}`,
          );
        this.progress(`输出校验失败，正在请求一次修正：${reason}`);
        messages.push({
          role: "user",
          content:
            "结果未通过结构或证据校验。只引用已取得的证据 ID，保留完整必填字段；不能扩大项目权限。错误类型：" +
            reason,
        });
      }
    }
    throw new AppError("OUTPUT_INVALID", "未取得有效输出");
  }
  async extract(
    expectedRevision: number,
    signal: AbortSignal,
  ): Promise<RequirementSet> {
    if (!this.reader.context.documents.length)
      throw new AppError("DOCUMENT_REQUIRED", "请先关联可读取的需求文档");
    return this.corrected(EXTRACTION_GOAL, {}, signal, (value) => {
      const proposal = extracted.parse(value);
      return this.requirements.createRevision(
        this.reader,
        proposal.items.map((item) => ({
          id: randomUUID(),
          text: item.text,
          acceptanceCriteria: item.acceptanceCriteria,
          clarification: item.clarification,
          reviewed: false,
          sourceRefs: item.sourceEvidenceIds.map((id) => {
            const ref = this.evidence.get(id);
            if (ref?.kind !== "document")
              throw new AppError(
                "OUTPUT_INVALID",
                "需求引用了不存在的原文证据",
              );
            return {
              documentSnapshotId: ref.documentSnapshotId,
              blockId: ref.blockId,
              quoteHash: ref.quoteHash,
            };
          }),
        })),
        expectedRevision,
      );
    });
  }
  async preanalyze(
    task: Task,
    issue: IssueSnapshot,
    signal: AbortSignal,
  ): Promise<BugReport> {
    if (
      issue.projectId !== task.projectId ||
      issue.id !== this.reader.context.issueSnapshotId
    )
      throw new AppError("CONTEXT_MISMATCH", "BUG 材料不属于当前分析上下文");
    const goal =
      "BUG 预分析：只基于本次 issue 与 materials 取证。输出 JSON {reproduction:string[], facts:[{text:string,evidenceIds:string[]}], hypotheses:[{text:string,supportEvidenceIds:string[],counterEvidenceIds:string[],nextSteps:string[]}], missingInformation:string[]}。facts 只描述有代码证据的事实；hypotheses 是待验证原因，不能宣称已确定根因。需通过工具读取代码；存在可解析日志时必须使用 readLog 或 searchLogs 取证并说明覆盖范围，不能将零搜索命中当作历史 BUG 无效。说明调用路径和可执行排查步骤。";
    return this.corrected(goal, { issue }, signal, async (value) => {
      const proposal = BugProposalSchema.parse(value);
      if (!proposal.facts.length && !proposal.hypotheses.length) {
        if (proposal.missingInformation.length)
          throw new AppError(
            "BUG_EVIDENCE_INSUFFICIENT",
            `材料不足，未生成成功报告：${proposal.missingInformation.join("；").slice(0, 1500)}`,
          );
        throw new AppError(
          "OUTPUT_INVALID",
          "BUG 输出完全为空，未形成分析结果",
        );
      }
      const allIds = new Set([
        ...proposal.facts.flatMap((f) => f.evidenceIds),
        ...proposal.hypotheses.flatMap((h) => [
          ...h.supportEvidenceIds,
          ...h.counterEvidenceIds,
        ]),
      ]);
      const refs = [...allIds].map((id) => {
        const ref = this.evidence.get(id);
        if (!ref)
          throw new AppError("OUTPUT_INVALID", "BUG 结论引用了未取得的证据");
        return ref;
      });
      for (const fact of proposal.facts)
        if (
          !fact.evidenceIds.some((id) => isCodeEvidence(this.evidence.get(id)))
        )
          throw new AppError(
            "OUTPUT_INVALID",
            "BUG 事实必须引用本次取得的代码证据",
          );
      for (const hypothesis of proposal.hypotheses)
        if (
          ![
            ...hypothesis.supportEvidenceIds,
            ...hypothesis.counterEvidenceIds,
          ].some((id) => isCodeEvidence(this.evidence.get(id)))
        )
          throw new AppError(
            "OUTPUT_INVALID",
            "BUG 候选原因必须引用本次取得的代码依据；没有代码依据时只报告缺失信息",
          );
      await new EvidenceValidator().validate(refs, this.reader, signal);
      if(this.reader.context.issueLogs&&this.reader.logs().status==="READY"&&!refs.some(ref=>ref.kind==="log"))throw new AppError("OUTPUT_INVALID","已准备日志，报告必须引用本次实际读取的日志证据；不能只依据问题描述生成结论");
      return BugReportSchema.parse({
        ...proposal,
        schemaVersion: 2,
        id: randomUUID(),
        projectId: task.projectId,
        taskId: task.id,
        attemptId: task.attemptId ?? task.id,
        contextSnapshotId: this.reader.context.id,
        issueSnapshotId: issue.id,
        createdAt: new Date().toISOString(),
        executorVersion: this.model.version,
        executorConfiguration: this.model.identity,
        templateVersion: "bugs-2-current-code-logs",
        evidenceRefs: refs,
        checkedScope: this.trace.length
          ? [...this.trace]
          : ["未取得代码取证范围"],
        verification: "STATIC_PRELIMINARY",
        limitations: [
          ...this.reader.context.limitations,
          ...issue.warnings,
          "静态预分析，未运行项目或确认根因；候选原因需人工验证",
          `问题版本：${issue.versions.join("、") || "未提供"}；本次使用当前工作区快照（包含未提交修改），未证明与故障版本一致，不据当前代码否定历史问题`,
          ...(this.reader.context.issueLogs ? this.reader.logs().files.filter(file=>file.status!=="PARSED"&&file.error!=="附件原件").map(file=>`未解析材料：${file.path}：${file.error}`) : issue.attachments.map(
            (a) => `未解析附件：${a.name}（${a.mediaType}，${a.size} 字节）`,
          )),
          ...(this.reader.context.sourceGaps ?? []).map((g) => g.message),
          ...this.reader.context.documents.flatMap((d) =>
            this.reader.document(d.id).warnings.map((w) => w.message),
          ),
        ],
        usage: this.usageKnown
          ? { inputTokens: this.inputTokens, outputTokens: this.outputTokens }
          : null,
      });
    });
  }
  async check(
    task: Task,
    set: RequirementSet,
    signal: AbortSignal,
  ): Promise<AnalysisReport> {
    if (set.projectId !== this.reader.context.projectId)
      throw new AppError("CONTEXT_MISMATCH", "需求不属于当前项目");
    if (!set.items.length)
      throw new AppError("REQUIREMENTS_EMPTY", "没有可核对需求");
    const input = set.items.map((item) => ({
      ...item,
      sourceRefs: item.sourceRefs.map((ref) => {
        const excerpt = this.reader.readSource(ref);
        this.remember(excerpt.evidence);
        return excerpt;
      }),
    }));
    return this.corrected(CHECK_GOAL, input, signal, async (value) => {
      const proposal = checked.parse(value);
      if (
        proposal.findings.length !== set.items.length ||
        new Set(proposal.findings.map((f) => f.requirementId)).size !==
          set.items.length ||
        proposal.findings.some(
          (f) => !set.items.some((item) => item.id === f.requirementId),
        )
      )
        throw new AppError("OUTPUT_INVALID", "每个需求必须恰好有一项结论");
      const findings = proposal.findings.map((finding) => {
        const item = input.find((i) => i.id === finding.requirementId)!;
        const refs = finding.evidenceIds.map((id) => {
          const evidence = this.evidence.get(id);
          if (!evidence)
            throw new AppError("OUTPUT_INVALID", "结论引用了未取得的证据");
          return evidence;
        });
        const evidenceIds = [
          ...new Set([
            ...finding.evidenceIds,
            ...item.sourceRefs.map((source) => source.evidence.id),
          ]),
        ];
        const loss =
          !item.acceptanceCriteria.length ||
          item.sourceRefs.some(
            (ref) =>
              ref.block.warnings.length > 0 ||
              this.reader
                .document(
                  ref.evidence.kind === "document"
                    ? ref.evidence.documentSnapshotId
                    : "",
                )
                .warnings.some((w) => !w.blockId || w.blockId === ref.block.id),
          ) ||
          Boolean(this.reader.context.sourceGaps?.length);
        const status = loss ? ("UNKNOWN" as const) : finding.status;
        if (status !== "UNKNOWN" && !refs.some(isCodeEvidence))
          throw new AppError(
            "OUTPUT_INVALID",
            "可确认结论必须取得代码证据，搜索不到不代表缺失",
          );
        return {
          ...finding,
          evidenceIds,
          status,
          explanation:
            finding.explanation +
            (loss
              ? "；原文解析缺口、资料缺失或验收条件不明确，标记无法确认"
              : ""),
          checkedScope: this.trace.length
            ? [...this.trace]
            : ["未取得充分代码取证范围"],
          verification: "STATIC" as const,
        };
      });
      const ids = new Set(findings.flatMap((f) => f.evidenceIds));
      const refs = [...this.evidence.values()].filter((e) => ids.has(e.id));
      await new EvidenceValidator().validate(refs, this.reader, signal);
      return AnalysisReportSchema.parse({
        schemaVersion: 1,
        id: randomUUID(),
        projectId: task.projectId,
        taskId: task.id,
        attemptId: task.attemptId ?? task.id,
        contextSnapshotId: this.reader.context.id,
        requirementSetId: set.id,
        inputSnapshotIds: this.reader.context.documents.map((d) => d.id),
        executorVersion: this.model.version,
        executorConfiguration: this.model.identity,
        templateVersion: "requirements-1",
        createdAt: new Date().toISOString(),
        findings,
        evidenceRefs: refs,
        limitations: [
          ...this.reader.context.limitations,
          "静态分析，未运行验证",
          "需求来源按相同内容哈希映射到本次快照；初始预览和检索存在明确范围限制",
        ],
        sourceGaps: this.reader.context.sourceGaps ?? [],
        parseWarnings: this.reader.context.documents
          .map((ref) => ({
            documentSnapshotId: ref.id,
            bindingId: ref.bindingId,
            warnings: this.reader.document(ref.id).warnings,
          }))
          .filter((item) => item.warnings.length),
        usage: this.usageKnown
          ? { inputTokens: this.inputTokens, outputTokens: this.outputTokens }
          : null,
      });
    });
  }
}
