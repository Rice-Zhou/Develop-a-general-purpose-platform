import { createHash } from "node:crypto";
import type {
  ContextSnapshot,
  RepositorySnapshot,
} from "../../../contracts/src/models";
import type {
  DocumentSnapshot,
  DocumentBlock,
} from "../../../contracts/src/documents";
import type { EvidenceRef } from "../../../contracts/src/analysis";
import { AppError } from "../../../contracts/src/error";
import { assertReadablePath } from "./access-policy";
export const textHash = (text: string) =>
  createHash("sha256").update(text).digest("hex");
export interface EvidenceExcerpt {
  text: string;
  evidence: EvidenceRef;
}
export class ContextReader {
  constructor(
    readonly context: ContextSnapshot,
    private readonly store: {
      getDocument(projectId: string, id: string): DocumentSnapshot;
      getIssueLogSet?(id:string):import("../../../contracts/src/issue-materials").IssueLogSet;
    },
    private readonly git: {
      readFile(
        snapshot: RepositorySnapshot,
        path: string,
        signal?: AbortSignal,
      ): Promise<Buffer>;
    },
    private readonly content: { get(hash: string): Promise<Buffer>;readLines?(hash:string,start:number,end:number,signal?:AbortSignal):Promise<{text:string;endLine:number}> },
  ) {}
  logs() {
    const ref=this.context.issueLogs;
    if(!ref||!this.store.getIssueLogSet)throw new AppError("LOG_DENIED","日志不在当前分析上下文");
    const set=this.store.getIssueLogSet(ref.id);
    if(set.manifestHash!==ref.manifestHash||!["READY","NO_LOGS"].includes(set.status))throw new AppError("EVIDENCE_INVALID","日志清单版本不匹配或未就绪");
    return set;
  }
  async readLog(logSetId:string,fileId:string,startLine:number,endLine:number,signal?:AbortSignal):Promise<EvidenceExcerpt> {
    const set=this.logs();if(set.id!==logSetId)throw new AppError("LOG_DENIED","日志不在当前上下文");
    const file=set.files.find(file=>file.id===fileId&&file.status==="PARSED"&&file.contentHash);
    if(!file||!this.content.readLines)throw new AppError("LOG_DENIED","日志文件不可读取");
    if(!Number.isSafeInteger(startLine)||!Number.isSafeInteger(endLine)||startLine<1||endLine<startLine||endLine-startLine>=400||startLine>file.lineCount)throw new AppError("LINE_RANGE_DENIED","日志读取范围须为 1—400 行且位于文件内");
    const excerpt=await this.content.readLines(file.contentHash!,startLine,Math.min(endLine,file.lineCount),signal);const snippetHash=textHash(excerpt.text);
    return {text:excerpt.text,evidence:{kind:"log",id:textHash(`${this.context.id}:${set.id}:${file.id}:${startLine}:${excerpt.endLine}:${snippetHash}`),projectId:this.context.projectId,contextSnapshotId:this.context.id,logSetId:set.id,manifestHash:set.manifestHash,fileId:file.id,contentHash:file.contentHash!,startLine,endLine:excerpt.endLine,snippetHash}};
  }
  async searchLogs(query:string,limit=10,signal?:AbortSignal) {
    const set=this.logs();const results:EvidenceExcerpt[]=[];
    for(const file of set.files.filter(file=>file.status==="PARSED").slice(0,150)) {
      if(!file.lineCount)continue;
      const excerpt=await this.readLog(set.id,file.id,1,Math.min(file.lineCount,100),signal);
      if(excerpt.text.toLowerCase().includes(query.toLowerCase()))results.push(excerpt);
      if(results.length>=limit)break;
    }
    return {results,limitation:"日志搜索仅覆盖前 150 个文本文件的前 100 行；可按文件 ID 和行号继续读取，不命中不代表无相关记录"};
  }
  document(id: string): DocumentSnapshot {
    const ref = this.context.documents.find((d) => d.id === id);
    if (!ref) throw new AppError("DOCUMENT_DENIED", "文档不在当前上下文");
    const doc = this.store.getDocument(this.context.projectId, id);
    if (doc.contentHash !== ref.contentHash || doc.bindingId !== ref.bindingId)
      throw new AppError("CONTENT_CORRUPTED", "文档快照引用不匹配");
    return doc;
  }
  readBlock(
    documentId: string,
    blockId: string,
  ): {
    text: string;
    evidence: Extract<EvidenceRef, { kind: "document" }>;
    block: DocumentBlock;
  } {
    const block = this.document(documentId).blocks.find(
      (b) => b.id === blockId,
    );
    if (!block) throw new AppError("BLOCK_NOT_FOUND", "原文块不在当前文档快照");
    const quoteHash = textHash(block.text);
    const evidence: Extract<EvidenceRef, { kind: "document" }> = {
      id: textHash(`${documentId}:${blockId}:${quoteHash}`),
      kind: "document",
      projectId: this.context.projectId,
      contextSnapshotId: this.context.id,
      documentSnapshotId: documentId,
      blockId,
      quoteHash,
    };
    return { block, text: block.text, evidence };
  }
  async verifySources(): Promise<void> {
    for (const ref of this.context.documents) {
      this.document(ref.id);
      await this.content.get(ref.contentHash);
    }
  }
  readSource(ref: {
    documentSnapshotId: string;
    blockId: string;
    quoteHash: string;
  }): ReturnType<ContextReader["readBlock"]> {
    const original = this.store.getDocument(
      this.context.projectId,
      ref.documentSnapshotId,
    );
    const current = this.context.documents.find(
      (d) =>
        d.bindingId === original.bindingId &&
        d.contentHash === original.contentHash,
    );
    if (!current)
      throw new AppError(
        "REQUIREMENTS_STALE",
        "需求原文已改变，请重新提取或确认需求",
      );
    const excerpt = this.readBlock(current.id, ref.blockId);
    if (excerpt.evidence.quoteHash !== ref.quoteHash)
      throw new AppError("EVIDENCE_INVALID", "原文锚点或哈希失效");
    return excerpt;
  }
  async readCode(
    bindingId: string,
    path: string,
    startLine: number,
    endLine: number,
    signal?: AbortSignal,
  ): Promise<EvidenceExcerpt> {
    assertReadablePath(path);
    const repo = this.context.repositories.find(
      (r) => r.bindingId === bindingId,
    );
    if (!repo) throw new AppError("REPOSITORY_DENIED", "仓库不在当前项目快照");
    if (
      !Number.isSafeInteger(startLine) ||
      !Number.isSafeInteger(endLine) ||
      startLine < 1 ||
      endLine < startLine ||
      endLine - startLine >= 400
    )
      throw new AppError("LINE_RANGE_DENIED", "代码读取范围须为 1—400 行");
    const entry = repo.files.find(file=>file.path===path);
    if (!entry) throw new AppError("PATH_DENIED","文件不在此快照的可读清单内");
    const bytes = repo.kind === "worktree" ? await this.content.get(repo.files.find(file=>file.path===path)!.contentHash) : await this.git.readFile(repo, path, signal);
    if (bytes.includes(0))
      throw new AppError("BINARY_FILE", "该文件不是可检索文本");
    const text = bytes.toString("utf8");
    if (text.includes("\uFFFD"))
      throw new AppError(
        "TEXT_ENCODING_UNSUPPORTED",
        "该文件不是可靠的 UTF-8 文本",
      );
    const lines = text.split(/\r?\n/);
    if (startLine > lines.length)
      throw new AppError("LINE_RANGE_DENIED", "代码行超出快照文件范围");
    const actualEnd = Math.min(endLine, lines.length);
    const excerpt = lines.slice(startLine - 1, actualEnd).join("\n");
    const snippetHash = textHash(excerpt);
    if(repo.kind === "worktree") {
      const contentHash=repo.files.find(file=>file.path===path)!.contentHash;
      return {text:excerpt,evidence:{kind:"worktree-code",id:textHash(`${bindingId}:${repo.manifestHash}:${path}:${startLine}:${actualEnd}:${snippetHash}`),projectId:this.context.projectId,contextSnapshotId:this.context.id,bindingId,manifestHash:repo.manifestHash,contentHash,path,startLine,endLine:actualEnd,snippetHash}};
    }
    return {
      text: excerpt,
      evidence: {
        id: textHash(
          `${bindingId}:${repo.commit}:${path}:${startLine}:${actualEnd}:${snippetHash}`,
        ),
        kind: "code",
        projectId: this.context.projectId,
        contextSnapshotId: this.context.id,
        bindingId,
        commit: repo.commit,
        path,
        startLine,
        endLine: actualEnd,
        snippetHash,
      },
    };
  }
}
