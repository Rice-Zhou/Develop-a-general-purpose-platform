import { z } from "zod";
const name=z.string().trim().min(1).max(200);
const common={id:z.string().min(1).optional(),name,categoryId:z.uuid().nullable().default(null),purpose:z.enum(["requirement","ui","ue","general"]).default("requirement"),notes:z.string().max(20000).default(""),required:z.boolean().default(true)};
const located=(kind:"docx"|"pdf"|"feishu"|"url"|"path")=>z.object({...common,kind:z.literal(kind),locator:z.string().trim().min(1).max(4096)});
export const LibraryResourceDraftSchema=z.discriminatedUnion("kind",[located("docx"),located("pdf"),located("feishu"),located("url"),located("path"),z.object({...common,kind:z.literal("note"),text:z.string().trim().min(1).max(200000)})]).superRefine((r,c)=>{if((r.kind==="url"||r.kind==="feishu")&&!URL.canParse(r.locator))c.addIssue({code:"custom",message:"请输入有效链接",path:["locator"]});if((r.kind==="url"||r.kind==="feishu")&&URL.canParse(r.locator)&&!["https:","http:"].includes(new URL(r.locator).protocol))c.addIssue({code:"custom",message:"只允许 HTTP/HTTPS 链接",path:["locator"]});});
export type LibraryResourceDraft=z.input<typeof LibraryResourceDraftSchema>;
export type LibraryResource=z.output<typeof LibraryResourceDraftSchema>&{id:string;revision:number;contentRevision:number};
export const LibraryCategoryDraftSchema=z.object({id:z.uuid().optional(),name,parentId:z.uuid().nullable()});
export type LibraryCategoryDraft=z.infer<typeof LibraryCategoryDraftSchema>;
export type LibraryCategory=LibraryCategoryDraft&{id:string;revision:number};
export const ProjectResourceLinkSchema=z.object({resourceId:z.string().min(1),role:z.enum(["requirement","reference"]),required:z.boolean()}).strict();
export type ProjectResourceLink=z.infer<typeof ProjectResourceLinkSchema>;
export interface Library {resources:LibraryResource[];categories:LibraryCategory[]}
export function isDocumentResource(r:LibraryResource):r is LibraryResource&{kind:"docx"|"pdf"|"feishu";locator:string}{return r.kind==="docx"||r.kind==="pdf"||r.kind==="feishu";}
