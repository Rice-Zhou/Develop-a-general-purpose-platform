import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { AppError } from "../../contracts/src/error";
import {LibraryResourceDraftSchema,LibraryCategoryDraftSchema,ProjectResourceLinkSchema,isDocumentResource,type LibraryResource,type LibraryResourceDraft,type LibraryCategoryDraft,type LibraryCategory,type ProjectResourceLink} from "../../contracts/src/library";
export class LibraryStore {
 constructor(private db:Database.Database){}
 resources():LibraryResource[]{return (this.db.prepare("SELECT json FROM library_resources ORDER BY rowid").all() as {json:string}[]).map(r=>JSON.parse(r.json));}
 categories():LibraryCategory[]{return (this.db.prepare("SELECT json FROM library_categories ORDER BY rowid").all() as {json:string}[]).map(r=>JSON.parse(r.json));}
 links(projectId:string):ProjectResourceLink[]{return this.db.prepare("SELECT resource_id AS resourceId,role,required FROM project_resource_links WHERE project_id=? ORDER BY rowid").all(projectId).map(r=>({...r as ProjectResourceLink,required:Boolean((r as ProjectResourceLink).required)}));}
 saveResource(value:LibraryResourceDraft,expected?:number):LibraryResource{
  const draft=LibraryResourceDraftSchema.parse(value);
  return this.db.transaction(()=>{
   const previous=draft.id?this.resources().find(r=>r.id===draft.id):undefined;
   if(draft.id&&!previous)throw new AppError("DOCUMENT_NOT_FOUND","资料不存在");
   this.revision(previous?.revision,expected);
   if(draft.categoryId&&!this.categories().some(c=>c.id===draft.categoryId))throw new AppError("CATEGORY_NOT_FOUND","分类不存在");
   const content=(r:typeof draft)=>JSON.stringify([r.kind,r.kind==="note"?r.text:r.locator]);
   const changed=Boolean(previous&&content(previous)!==content(draft));
   if(previous&&!["docx","pdf","feishu"].includes(draft.kind)&&this.db.prepare("SELECT 1 FROM project_resource_links WHERE resource_id=? AND role='requirement'").get(previous.id))throw new AppError("RESOURCE_REFERENCE_ONLY","该资料仍作为审核需求关联，请先解除需求关联再改为参考类型");
   const resource={...draft,id:previous?.id??randomUUID(),revision:(previous?.revision??0)+1,contentRevision:(previous?.contentRevision??1)+(changed?1:0)};
   this.db.prepare("INSERT INTO library_resources(id,json) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json").run(resource.id,JSON.stringify(resource));
   if(changed){for(const row of this.db.prepare("SELECT p.id,p.json FROM projects p JOIN project_resource_links l ON l.project_id=p.id WHERE l.resource_id=? AND l.role='requirement'").all(resource.id) as {id:string;json:string}[]){const p=JSON.parse(row.json);p.revision++;p.updatedAt=new Date().toISOString();this.db.prepare("UPDATE projects SET revision=?,json=? WHERE id=?").run(p.revision,JSON.stringify(p),p.id);}}
   return resource;
  })();
 }
 deleteResource(id:string,expected:number){this.db.transaction(()=>{const r=this.resources().find(r=>r.id===id);if(!r)throw new AppError("DOCUMENT_NOT_FOUND","资料不存在");this.revision(r.revision,expected);if(this.db.prepare("SELECT 1 FROM project_resource_links l JOIN projects p ON p.id=l.project_id WHERE l.resource_id=? AND json_extract(p.json,'$.deletedAt') IS NULL").get(id))throw new AppError("DOCUMENT_IN_USE","资料仍有关联项目，请先解除关联");this.db.prepare("DELETE FROM project_resource_links WHERE resource_id=?").run(id);this.db.prepare("DELETE FROM library_resources WHERE id=?").run(id);})();}
 saveCategory(value:LibraryCategoryDraft,expected?:number):LibraryCategory{
  const draft=LibraryCategoryDraftSchema.parse(value);return this.db.transaction(()=>{const all=this.categories();const previous=all.find(c=>c.id===draft.id);if(draft.id&&!previous)throw new AppError("CATEGORY_NOT_FOUND","分类不存在");this.revision(previous?.revision,expected);let parent=draft.parentId;const seen=new Set([draft.id]);while(parent){if(seen.has(parent))throw new AppError("CATEGORY_CYCLE","分类不能形成循环");seen.add(parent);const c=all.find(c=>c.id===parent);if(!c)throw new AppError("CATEGORY_NOT_FOUND","父分类不存在");parent=c.parentId;}const saved={...draft,id:previous?.id??randomUUID(),revision:(previous?.revision??0)+1};this.db.prepare("INSERT INTO library_categories(id,json) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json").run(saved.id,JSON.stringify(saved));return saved;})();
 }
 deleteCategory(id:string,expected:number){this.db.transaction(()=>{const c=this.categories().find(c=>c.id===id);if(!c)throw new AppError("CATEGORY_NOT_FOUND","分类不存在");this.revision(c.revision,expected);if(this.categories().some(c=>c.parentId===id)||this.resources().some(r=>r.categoryId===id))throw new AppError("CATEGORY_NOT_EMPTY","分类非空，请先移动资料和子分类");this.db.prepare("DELETE FROM library_categories WHERE id=?").run(id);})();}
 replaceLinks(projectId:string,links:ProjectResourceLink[]){const resources=this.resources();const ids=new Set<string>();for(const raw of links){const l=ProjectResourceLinkSchema.parse(raw);if(ids.has(l.resourceId))throw new AppError("RESOURCE_DUPLICATE","不能重复关联资料");ids.add(l.resourceId);const r=resources.find(r=>r.id===l.resourceId);if(!r)throw new AppError("DOCUMENT_NOT_FOUND","关联资料不存在");if(l.role==="requirement"&&!isDocumentResource(r))throw new AppError("RESOURCE_REFERENCE_ONLY","该资料仅支持参考关联");}this.db.prepare("DELETE FROM project_resource_links WHERE project_id=?").run(projectId);const insert=this.db.prepare("INSERT INTO project_resource_links VALUES(?,?,?,?)");for(const l of links)insert.run(projectId,l.resourceId,l.role,Number(l.required));}
 private revision(current:number|undefined,expected:number|undefined){if(current!==expected)throw new AppError("REVISION_CONFLICT","资料或分类版本已被更新，请重新加载");}
}
