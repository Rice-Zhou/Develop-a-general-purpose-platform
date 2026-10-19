import type { Project } from "../../../contracts/src/models";
import type { ParsedDocument } from "../../../contracts/src/documents";
export type DocumentBinding = Project["documents"][number];
export interface SourceCapture {
  bytes: Buffer;
  hash: string;
  fetchedAt: string;
  revision: string | null;
}
export interface DocumentSource {
  fetch(binding: DocumentBinding, signal: AbortSignal): Promise<SourceCapture>;
}
export interface DocumentParser {
  parse(
    kind: DocumentBinding["kind"],
    bytes: Buffer,
    signal: AbortSignal,
  ): Promise<ParsedDocument>;
}
