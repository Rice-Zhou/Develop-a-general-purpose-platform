import { z } from "zod";
export const LOG_BUDGET = Object.freeze({attachment:512*1024*1024,issue:2*1024*1024*1024,concurrency:1,uncompressed:2*1024*1024*1024,files:10000,nesting:2});
export const AttachmentDescriptorSchema=z.object({id:z.string().min(1).max(2048),name:z.string().min(1).max(2048),mediaType:z.string().max(200),size:z.number().int().nonnegative().nullable(),version:z.string().min(1)}).strict();
export type AttachmentDescriptor=z.infer<typeof AttachmentDescriptorSchema>;
export const IssueLogScopeSchema=z.object({platform:z.enum(["jira-cloud","jira-dc","trinity"]),instanceUrl:z.string(),accountId:z.string().min(1),remoteIssueId:z.string().min(1)}).strict();
export type IssueLogScope=z.infer<typeof IssueLogScopeSchema>;
export const LogFileSchema=z.object({id:z.string(),attachmentId:z.string(),path:z.string(),originalHash:z.string(),contentHash:z.string().nullable(),size:z.number().int().nonnegative(),encoding:z.string().nullable(),lineCount:z.number().int().nonnegative(),status:z.enum(["PARSED","UNSUPPORTED","FAILED"]),error:z.string().nullable()}).strict();
export type LogFile=z.infer<typeof LogFileSchema>;
export const IssueLogSetSchema=z.object({id:z.string(),scope:IssueLogScopeSchema,issueVersion:z.string(),generation:z.number().int().positive(),status:z.enum(["QUEUED","DOWNLOADING","READY","NO_LOGS","FAILED","UNSUPPORTED","CANCELLED"]),attachments:z.array(AttachmentDescriptorSchema),files:z.array(LogFileSchema),manifestHash:z.string(),error:z.string().nullable(),updatedAt:z.string()}).strict();
export type IssueLogSet=z.infer<typeof IssueLogSetSchema>;
export interface IssueLogSetRef {id:string;manifestHash:string}
export const BugAnalysisOptionsSchema=z.object({logPolicy:z.enum(["required","code-only"])}).strict();
export type BugAnalysisOptions=z.infer<typeof BugAnalysisOptionsSchema>;
