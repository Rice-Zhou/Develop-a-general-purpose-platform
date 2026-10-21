import { AppError } from "../../../contracts/src/error";
import type { EvidenceRef } from "../../../contracts/src/analysis";
import { ContextReader } from "../context/context-reader";
export class EvidenceValidator {
  async validate(
    refs: EvidenceRef[],
    reader: ContextReader,
    signal?: AbortSignal,
  ): Promise<void> {
    const seen = new Set<string>();
    for (const ref of refs) {
      if (
        seen.has(ref.id) ||
        ref.projectId !== reader.context.projectId ||
        ref.contextSnapshotId !== reader.context.id
      )
        throw new AppError(
          "EVIDENCE_INVALID",
          "证据重复或不属于当前项目和上下文",
        );
      seen.add(ref.id);
      const actual =
        ref.kind === "document"
          ? reader.readBlock(ref.documentSnapshotId, ref.blockId).evidence
          : ref.kind === "log" ? (await reader.readLog(ref.logSetId,ref.fileId,ref.startLine,ref.endLine,signal)).evidence
          : (
              await reader.readCode(
                ref.bindingId,
                ref.path,
                ref.startLine,
                ref.endLine,
                signal,
              )
            ).evidence;
      if (
        actual.kind !== ref.kind ||
        Object.keys(actual).some(
          (key) =>
            actual[key as keyof typeof actual] !== ref[key as keyof typeof ref],
        )
      )
        throw new AppError(
          "EVIDENCE_INVALID",
          "证据版本、行范围、片段哈希或引用 ID 不真实",
        );
    }
  }
}
