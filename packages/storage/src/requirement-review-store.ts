import type Database from "better-sqlite3";
import {randomUUID} from "node:crypto";
import {AppError} from "../../contracts/src/error";
import type {AnalysisReport} from "../../contracts/src/analysis";
import type {RequirementSet} from "../../contracts/src/requirements";
import type {RequirementReviewItem,ReviewRunToken,RequirementDecision,ReviewState} from "../../contracts/src/requirement-review";
import {reviewFingerprint,nextReviewState,type ReviewSourceIndex} from "../../core/src/requirements/review-service";
export class RequirementReviewStore{
 constructor(private db:Database.Database){}
 list(projectId:string):RequirementReviewItem[]{return (this.db.prepare("SELECT json FROM requirement_reviews WHERE project_id=? ORDER BY rowid").all(projectId) as {json:string}[]).map(r=>JSON.parse(r.json));}
 token(projectId:string):ReviewRunToken{return {decisionSequence:(this.db.prepare("SELECT COALESCE(MAX(sequence),0) AS n FROM requirement_review_events WHERE project_id=?").get(projectId) as {n:number}).n};}
 decide(id:string,action:RequirementDecision,expected:number):RequirementReviewItem{return this.db.transaction(()=>{
 const row=this.db.prepare("SELECT json FROM requirement_reviews WHERE id=?").get(id) as {json:string}|undefined;if(!row)throw new AppError("REVIEW_NOT_FOUND","需求待办不存在");const item=JSON.parse(row.json) as RequirementReviewItem;
 if(item.revision!==expected)throw new AppError("REVISION_CONFLICT","该需求待办已更新，请刷新后处理");
 const allowed=action==="restore"?["FALSE_POSITIVE","DONE"]:action==="complete"?["CONFIRMED_MISSING"]:action==="false-positive"?["PENDING","CONFIRMED_MISSING"]:["PENDING"];
 if(!allowed.includes(item.state))throw new AppError("REVIEW_TRANSITION_INVALID","请按未完成确认和完成步骤处理");
 const states:Record<RequirementDecision,ReviewState>={"false-positive":"FALSE_POSITIVE","confirm-missing":"CONFIRMED_MISSING",complete:"DONE",restore:"PENDING"};
 const saved={...item,state:states[action],revision:item.revision+1,updatedAt:new Date().toISOString()};this.save(saved);
 this.db.prepare("INSERT INTO requirement_review_events(project_id,item_id,action,created_at,basis_json) VALUES(?,?,?,?,?)").run(item.projectId,item.id,action,saved.updatedAt,JSON.stringify({reportId:item.reportId,requirementSetId:item.requirementSetId,requirementId:item.requirementId,revision:item.revision}));return saved;
 })();}
 reconcile(report:AnalysisReport,set:RequirementSet,sources:ReviewSourceIndex,runToken:ReviewRunToken):void{
 if(this.db.prepare("SELECT 1 FROM requirement_review_reports WHERE report_id=?").get(report.id))return;
 const all=this.list(report.projectId);const current=new Set<string>();
 const candidates=new Map<string,{requirement:RequirementSet["items"][number];finding:AnalysisReport["findings"][number]}>();
 const priority={MISSING:5,PARTIAL:4,CONFLICT:3,UNKNOWN:2,IMPLEMENTED:1};
 for(const requirement of set.items){
   const refs=requirement.sourceRefs.map(ref=>{
     const source=sources[`${ref.documentSnapshotId}:${ref.blockId}`];
     if(!source||source.quoteHash!==ref.quoteHash)throw new AppError("EVIDENCE_INVALID","审核来源无效，未归并待办");
     return source;
   });
   const fingerprint=reviewFingerprint(report.projectId,requirement,refs);current.add(fingerprint);
   const finding=report.findings.find(f=>f.requirementId===requirement.id);if(!finding)continue;
   const previous=candidates.get(fingerprint);
   // Duplicate semantic items remain in the immutable report; one missing candidate owns the human task.
   if(!previous||priority[finding.status]>priority[previous.finding.status])candidates.set(fingerprint,{requirement,finding});
 }
 for(const [fingerprint,{requirement,finding}] of candidates){
   const old=all.find(r=>r.fingerprint===fingerprint);
   if(!old&&finding.status!=="MISSING"&&finding.status!=="PARTIAL")continue;
   const event=old?this.db.prepare("SELECT COALESCE(MAX(sequence),0) AS n FROM requirement_review_events WHERE item_id=?").get(old.id) as {n:number}:undefined;
   this.save({id:old?.id??randomUUID(),projectId:report.projectId,fingerprint,state:old?nextReviewState(old.state,finding.status,(event?.n??0)>runToken.decisionSequence):"PENDING",revision:(old?.revision??0)+1,reportId:report.id,requirementSetId:set.id,requirementId:requirement.id,historicalSource:false,updatedAt:new Date().toISOString()});
 }
 for(const old of all)if(!current.has(old.fingerprint)&&!old.historicalSource)this.save({...old,historicalSource:true,revision:old.revision+1});
 this.db.prepare("INSERT INTO requirement_review_reports VALUES(?)").run(report.id);
 }
 events(id:string):import("../../contracts/src/requirement-review").RequirementReviewEvent[]{return (this.db.prepare("SELECT sequence,action,created_at,basis_json FROM requirement_review_events WHERE item_id=? ORDER BY sequence").all(id) as {sequence:number;action:RequirementDecision;created_at:string;basis_json:string|null}[]).map(e=>({sequence:e.sequence,action:e.action,createdAt:e.created_at,basis:e.basis_json?JSON.parse(e.basis_json):null}));}
 private save(item:RequirementReviewItem){this.db.prepare("INSERT INTO requirement_reviews VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json").run(item.id,item.projectId,item.fingerprint,JSON.stringify(item));}
}
