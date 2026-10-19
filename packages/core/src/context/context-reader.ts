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
    },
    private readonly git: {
      readFile(
        snapshot: RepositorySnapshot,
        path: string,
        signal?: AbortSignal,
      ): Promise<Buffer>;
    },
    private readonly content: { get(hash: string): Promise<Buffer> },
  ) {}
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
    const bytes = await this.git.readFile(repo, path, signal);
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
