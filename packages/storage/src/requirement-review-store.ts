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
 const allowed=action==="restore"?["FALSE_POSITIVE","DONE"]:action==="complete"?["CONFIRMED_MISSING"]:["PENDING"];
 if(!allowed.includes(item.state))throw new AppError("REVIEW_TRANSITION_INVALID","请按未完成确认和完成步骤处理");
 const states:Record<RequirementDecision,ReviewState>={"false-positive":"FALSE_POSITIVE","confirm-missing":"CONFIRMED_MISSING",complete:"DONE",restore:"PENDING"};
 const saved={...item,state:states[action],revision:item.revision+1,updatedAt:new Date().toISOString()};this.save(saved);
 this.db.prepare("INSERT INTO requirement_review_events(project_id,item_id,action,created_at) VALUES(?,?,?,?)").run(item.projectId,item.id,action,saved.updatedAt);return saved;
 })();}
 reconcile(report:AnalysisReport,set:RequirementSet,sources:ReviewSourceIndex,runToken:ReviewRunToken):void{
 if(this.db.prepare("SELECT 1 FROM requirement_review_reports WHERE report_id=?").get(report.id))return;
 const all=this.list(report.projectId);const current=new Set<string>();
 for(const req of set.items){const refs=req.sourceRefs.map(ref=>{const s=sources[`${ref.documentSnapshotId}:${ref.blockId}`];if(!s||s.quoteHash!==ref.quoteHash)throw new AppError("EVIDENCE_INVALID","审核来源无效，未归并待办");return s;});const fp=reviewFingerprint(report.projectId,req,refs);current.add(fp);const finding=report.findings.find(f=>f.requirementId===req.id);if(!finding)continue;const old=all.find(r=>r.fingerprint===fp);if(!old&&finding.status!=="MISSING"&&finding.status!=="PARTIAL")continue;
 const event=old?this.db.prepare("SELECT COALESCE(MAX(sequence),0) AS n FROM requirement_review_events WHERE item_id=?").get(old.id) as {n:number}:undefined;
 const item:RequirementReviewItem={id:old?.id??randomUUID(),projectId:report.projectId,fingerprint:fp,state:old?nextReviewState(old.state,finding.status,(event?.n??0)>runToken.decisionSequence):"PENDING",revision:(old?.revision??0)+1,reportId:report.id,requirementSetId:set.id,requirementId:req.id,historicalSource:false,updatedAt:new Date().toISOString()};this.save(item);
 }
 for(const old of all)if(!current.has(old.fingerprint)&&!old.historicalSource)this.save({...old,historicalSource:true,revision:old.revision+1});
 this.db.prepare("INSERT INTO requirement_review_reports VALUES(?)").run(report.id);
 }
 private save(item:RequirementReviewItem){this.db.prepare("INSERT INTO requirement_reviews VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json").run(item.id,item.projectId,item.fingerprint,JSON.stringify(item));}
}
