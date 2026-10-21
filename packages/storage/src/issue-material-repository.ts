import type Database from "better-sqlite3";
import {createHash} from "node:crypto";
import {IssueLogSetSchema,type IssueLogSet,type IssueLogScope} from "../../contracts/src/issue-materials";
import {AppError} from "../../contracts/src/error";
export const materialScopeKey=(scope:IssueLogScope)=>createHash("sha256").update(JSON.stringify([scope.platform,scope.instanceUrl,scope.accountId,scope.remoteIssueId])).digest("hex");
export class IssueMaterialRepository {
 constructor(private readonly db:Database.Database){}
 get(id:string):IssueLogSet {const row=this.db.prepare("SELECT json FROM issue_materials WHERE id=?").get(id) as {json:string}|undefined;if(!row)throw new AppError("ISSUE_LOG_NOT_FOUND","日志材料不存在");return IssueLogSetSchema.parse(JSON.parse(row.json));}
 latest(scope:IssueLogScope):IssueLogSet|null {const row=this.db.prepare("SELECT json FROM issue_materials WHERE scope_key=? ORDER BY generation DESC LIMIT 1").get(materialScopeKey(scope)) as {json:string}|undefined;return row?IssueLogSetSchema.parse(JSON.parse(row.json)):null;}
 create(value:IssueLogSet):void {const set=IssueLogSetSchema.parse(value);this.db.prepare("INSERT INTO issue_materials(id,scope_key,generation,status,json) VALUES(?,?,?,?,?)").run(set.id,materialScopeKey(set.scope),set.generation,set.status,JSON.stringify(set));}
 update(value:IssueLogSet):boolean {const set=IssueLogSetSchema.parse(value);return this.db.prepare("UPDATE issue_materials SET status=?,json=? WHERE id=? AND generation=(SELECT MAX(generation) FROM issue_materials WHERE scope_key=?)").run(set.status,JSON.stringify(set),set.id,materialScopeKey(set.scope)).changes===1;}
 recoverInterrupted():void {for(const row of this.db.prepare("SELECT json FROM issue_materials WHERE status IN ('QUEUED','DOWNLOADING')").all() as {json:string}[]){const set=IssueLogSetSchema.parse(JSON.parse(row.json));this.update({...set,status:"FAILED",error:"上次日志下载中断，请重试",updatedAt:new Date().toISOString()});}}
 referencedContent():Set<string> {const hashes=new Set<string>();for(const row of this.db.prepare("SELECT json FROM issue_materials").all() as {json:string}[])for(const file of IssueLogSetSchema.parse(JSON.parse(row.json)).files){hashes.add(file.originalHash);if(file.contentHash)hashes.add(file.contentHash);}return hashes;}
}
