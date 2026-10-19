import { z } from 'zod';
export const WarningSchema = z.object({ code: z.string(), message: z.string(), blockId: z.string().optional() }).strict();
export const DocumentBlockSchema = z.object({
  id: z.string().min(1), kind: z.enum(['heading','paragraph','list','table','image','unknown']), text: z.string(),
  headingPath: z.array(z.string()), anchor: z.object({ label:z.string(), page:z.number().int().positive().optional(), blockId:z.string().optional(), coordinates:z.array(z.number()).optional() }).strict(),
  table: z.array(z.array(z.string())).optional(), warnings:z.array(WarningSchema),
}).strict();
export const DocumentSnapshotSchema = z.object({
  schemaVersion:z.literal(1), id:z.string(), projectId:z.string(), bindingId:z.string(), kind:z.enum(['docx','pdf','feishu']),
  sourceLocator:z.string(), contentHash:z.string().regex(/^[a-f0-9]{64}$/), sourceRevision:z.string().nullable(), parserVersion:z.string(),
  fetchedAt:z.string(), blocks:z.array(DocumentBlockSchema), warnings:z.array(WarningSchema),
}).strict();
export type DocumentBlock = z.infer<typeof DocumentBlockSchema>;
export type DocumentSnapshot = z.infer<typeof DocumentSnapshotSchema>;
export type DocumentWarning = z.infer<typeof WarningSchema>;
export interface DocumentSnapshotRef { id:string; bindingId:string; contentHash:string; kind:DocumentSnapshot['kind']; }
export interface SourceGap { bindingId:string; code:string; message:string; required:boolean; affectedBlockIds:string[]; }
export interface ParsedDocument { blocks:DocumentBlock[]; warnings:DocumentWarning[]; parserVersion:string; }
