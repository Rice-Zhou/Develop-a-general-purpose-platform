import { randomUUID } from "node:crypto";
import { AppError } from "../../../contracts/src/error";
import {
  RequirementItemSchema,
  type RequirementItem,
  type RequirementSet,
} from "../../../contracts/src/requirements";
import { ContextReader } from "../context/context-reader";
export interface RequirementRepository {
  saveRequirementSet(set: RequirementSet, expectedRevision: number): void;
  latestRequirementSet(projectId: string): RequirementSet | null;
}
export class RequirementService {
  constructor(private readonly store: RequirementRepository) {}
  createRevision(
    reader: ContextReader,
    items: RequirementItem[],
    expectedRevision: number,
  ): RequirementSet {
    const parsed = RequirementItemSchema.array().max(500).parse(items);
    const seen = new Set<string>();
    for (const item of parsed) {
      if (seen.has(item.id))
        throw new AppError("DUPLICATE_REQUIREMENT", "需求 ID 重复");
      seen.add(item.id);
      item.sourceRefs = item.sourceRefs.map((ref) => {
        const excerpt = reader.readSource(ref);
        if (!excerpt.text.trim())
          throw new AppError(
            "EVIDENCE_INVALID",
            "原文块没有可读取文本，不能从中推断需求",
          );
        const actual = excerpt.evidence;
        return {
          documentSnapshotId: actual.documentSnapshotId,
          blockId: actual.blockId,
          quoteHash: actual.quoteHash,
        };
      });
      if (!item.acceptanceCriteria.length)
        item.clarification = item.clarification || "缺少可检验的验收条件";
    }
    return {
      schemaVersion: 1,
      id: randomUUID(),
      projectId: reader.context.projectId,
      contextSnapshotId: reader.context.id,
      revision: expectedRevision + 1,
      createdAt: new Date().toISOString(),
      items: parsed,
    };
  }
  saveRevision(
    reader: ContextReader,
    items: RequirementItem[],
    expectedRevision: number,
  ): RequirementSet {
    const set = this.createRevision(reader, items, expectedRevision);
    this.store.saveRequirementSet(set, expectedRevision);
    return set;
  }
}
