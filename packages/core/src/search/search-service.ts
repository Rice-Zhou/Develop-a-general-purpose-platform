import { randomUUID } from "node:crypto";
import { AppError } from "../../../contracts/src/error";
import type { ContextSnapshot } from "../../../contracts/src/models";
import type {
  EvidenceRef,
  SearchResult,
} from "../../../contracts/src/analysis";
export type { SearchResult } from "../../../contracts/src/analysis";
import { ContextReader } from "../context/context-reader";
interface SearchRepository {
  replaceSearchChunks(
    projectId: string,
    contextId: string,
    chunks: { id: string; text: string; metadata: unknown }[],
  ): void;
  searchChunks(
    projectId: string,
    contextId: string,
    query: string,
    limit: number,
  ): { text: string; metadata: unknown }[];
}
export class SearchService {
  constructor(private readonly store: SearchRepository) {}
  async index(reader: ContextReader, signal: AbortSignal): Promise<string[]> {
    await reader.verifySources();
    const chunks: { id: string; text: string; metadata: unknown }[] = [];
    const limitations: string[] = [];
    let files = 0;
    let characters = 0;
    let paths = 0;
    for (const ref of reader.context.documents)
      for (const block of reader.document(ref.id).blocks) {
        const excerpt = reader.readBlock(ref.id, block.id);
        chunks.push({
          id: randomUUID(),
          text: block.text,
          metadata: { evidence: excerpt.evidence },
        });
      }
    for (const repo of reader.context.repositories) {
      for (const file of repo.files) {
        if (signal.aborted) throw new AppError("CANCELLED", "索引已取消");
        if (++paths > 100000)
          throw new AppError("INDEX_PATH_LIMIT", "代码路径超过索引上限");
        chunks.push({
          id: randomUUID(),
          text: file.path,
          metadata: { evidence: null, path: `${repo.bindingId}:${file.path}` },
        });
        if (files >= 150 || characters >= 4 * 1024 * 1024) continue;
        try {
          const excerpt = await reader.readCode(
            repo.bindingId,
            file.path,
            1,
            400,
            signal,
          );
          files++;
          characters += excerpt.text.length;
          chunks.push({
            id: randomUUID(),
            text: excerpt.text,
            metadata: { evidence: excerpt.evidence, path: file.path },
          });
        } catch (error) {
          if (
            error instanceof AppError &&
            [
              "BINARY_FILE",
              "TEXT_ENCODING_UNSUPPORTED",
              "FILE_SIZE_LIMIT",
            ].includes(error.code)
          ) {
            limitations.push(
              `${repo.bindingId}:${file.path} 未进入文本索引（${error.code}）`,
            );
            continue;
          }
          throw error;
        }
      }
    }
    if (paths > 0)
      limitations.push(
        `内容检索仅覆盖 ${files}/${paths} 个文件的前 400 行；其余保留路径索引，可按固定提交继续取证，不能据零命中判定缺失`,
      );
    this.store.replaceSearchChunks(
      reader.context.projectId,
      reader.context.id,
      chunks,
    );
    return limitations;
  }
  search(context: ContextSnapshot, query: string, limit = 20): SearchResult {
    const term = query.trim();
    if (
      !term ||
      term.length > 200 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new AppError(
        "SEARCH_INPUT_INVALID",
        "查询须为 1—200 字符，返回条数为 1—100",
      );
    const rows = this.store.searchChunks(
      context.projectId,
      context.id,
      term,
      limit,
    );
    return {
      method: [...term].length >= 3 ? "trigram" : "bounded-scan",
      results: rows.map((row) => {
        const metadata = row.metadata as {
          evidence: EvidenceRef | null;
          path?: string;
        };
        return { text: row.text.slice(0, 2000), ...metadata };
      }),
    };
  }
}
