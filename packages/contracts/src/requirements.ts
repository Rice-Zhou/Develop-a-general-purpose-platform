import { z } from "zod";
export const SourceRefSchema = z
  .object({
    documentSnapshotId: z.string(),
    blockId: z.string(),
    quoteHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const RequirementItemSchema = z
  .object({
    id: z.string(),
    text: z.string().trim().min(1).max(10000),
    acceptanceCriteria: z.array(z.string().min(1)).max(50),
    sourceRefs: z.array(SourceRefSchema).min(1),
    clarification: z.string(),
    reviewed: z.boolean(),
  })
  .strict();
export const RequirementSetSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string(),
    projectId: z.string(),
    contextSnapshotId: z.string(),
    revision: z.number().int().positive(),
    createdAt: z.string(),
    items: z.array(RequirementItemSchema).max(500),
  })
  .strict();
export type RequirementItem = z.infer<typeof RequirementItemSchema>;
export type RequirementSet = z.infer<typeof RequirementSetSchema>;
