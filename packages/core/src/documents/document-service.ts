import { randomUUID } from "node:crypto";
import { AppError, errorData } from "../../../contracts/src/error";
import {
  DocumentSnapshotSchema,
  type DocumentSnapshot,
  type DocumentSnapshotRef,
  type SourceGap,
} from "../../../contracts/src/documents";
import type { DocumentSource, DocumentParser, DocumentBinding } from "./ports";
export class DocumentService {
  constructor(
    private readonly source: DocumentSource,
    private readonly parser: DocumentParser,
    private readonly content: {
      put(bytes: Buffer): Promise<{ hash: string; size: number }>;
    },
    private readonly store: { saveDocument(snapshot: DocumentSnapshot): void },
  ) {}
  async captureProject(
    project: { id: string; documents: DocumentBinding[] },
    signal: AbortSignal,
  ): Promise<{ documents: DocumentSnapshotRef[]; sourceGaps: SourceGap[] }> {
    const documents: DocumentSnapshotRef[] = [];
    const sourceGaps: SourceGap[] = [];
    let total = 0;
    for (const binding of project.documents) {
      try {
        const captured = await this.source.fetch(binding, signal);
        total += captured.bytes.length;
        if (total > 200 * 1024 * 1024)
          throw new AppError("DOCUMENT_TOTAL_LIMIT", "文档总量超过 200 MiB");
        const saved = await this.content.put(captured.bytes);
        if (saved.hash !== captured.hash)
          throw new AppError("CONTENT_CORRUPTED", "文档获取后的哈希不一致");
        const parsed = await this.parser.parse(
          binding.kind,
          captured.bytes,
          signal,
        );
        const snapshot = DocumentSnapshotSchema.parse({
          schemaVersion: 1,
          id: randomUUID(),
          projectId: project.id,
          bindingId: binding.id,
          kind: binding.kind,
          sourceLocator: binding.locator,
          contentHash: saved.hash,
          sourceRevision: captured.revision,
          parserVersion: parsed.parserVersion,
          fetchedAt: captured.fetchedAt,
          blocks: parsed.blocks,
          warnings: parsed.warnings,
        });
        this.store.saveDocument(snapshot);
        documents.push({
          id: snapshot.id,
          bindingId: binding.id,
          contentHash: snapshot.contentHash,
          kind: binding.kind,
        });
      } catch (error) {
        const diagnostic = errorData(error);
        if (
          binding.required ||
          [
            "CANCELLED",
            "PROCESS_STOP_UNCONFIRMED",
            "DOCUMENT_TOTAL_LIMIT",
            "CONTENT_CORRUPTED",
          ].includes(diagnostic.code)
        )
          throw error;
        sourceGaps.push({
          bindingId: binding.id,
          code: diagnostic.code,
          message: diagnostic.message,
          required: false,
          affectedBlockIds: [],
        });
      }
    }
    return { documents, sourceGaps };
  }
}
