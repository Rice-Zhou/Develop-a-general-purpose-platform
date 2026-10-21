import {it,expect} from "vitest";
import Database from "better-sqlite3";
import {migrateDatabase} from "./migrations";
import {RequirementReviewStore} from "./requirement-review-store";
import type {RequirementSet} from "../../contracts/src/requirements";
import type {AnalysisReport} from "../../contracts/src/analysis";
it("reconciles once, preserves late human decisions and reopens completed findings on the next audit",async()=>{
 const db=new Database(":memory:");await migrateDatabase(db,":memory:");db.prepare("INSERT INTO projects VALUES('p',1,'{}')").run();
 try{const s=new RequirementReviewStore(db);const set={id:"set",projectId:"p",items:[{id:"req",text:"功能",acceptanceCriteria:["条件"],sourceRefs:[{documentSnapshotId:"d",blockId:"b",quoteHash:"h"}]}]} as RequirementSet;
 const report={id:"report",projectId:"p",findings:[{requirementId:"req",status:"MISSING"}]} as AnalysisReport;const src={"d:b":{resourceId:"resource",quoteHash:"h"}};
 db.transaction(()=>s.reconcile(report,set,src,s.token("p")))();let item=s.list("p")[0];expect(item.state).toBe("PENDING");
 expect(()=>s.decide(item.id,"complete",item.revision)).toThrow(/确认/);
 item=s.decide(item.id,"confirm-missing",item.revision);const token=s.token("p");item=s.decide(item.id,"complete",item.revision);
 s.reconcile({...report,id:"late"},set,src,token);expect(s.list("p")[0].state).toBe("DONE");
 s.reconcile({...report,id:"next"},set,src,s.token("p"));item=s.list("p")[0];expect(item.state).toBe("PENDING");
 item=s.decide(item.id,"false-positive",item.revision);s.reconcile({...report,id:"repeat"},set,src,s.token("p"));expect(s.list("p")[0].state).toBe("FALSE_POSITIVE");
 const revision=s.list("p")[0].revision;s.reconcile({...report,id:"repeat"},set,src,s.token("p"));expect(s.list("p")[0].revision).toBe(revision);
 expect(()=>s.decide(item.id,"restore",1)).toThrow(/更新/);
 const basis=db.prepare("SELECT basis_json FROM requirement_review_events WHERE action='confirm-missing'").get() as {basis_json:string};expect(JSON.parse(basis.basis_json)).toMatchObject({reportId:"report",requirementSetId:"set",requirementId:"req"});
 }finally{db.close();}
});

it("merges duplicated semantic UUIDs within one report instead of rolling back",async()=>{
 const db=new Database(":memory:");await migrateDatabase(db,":memory:");db.prepare("INSERT INTO projects VALUES('p',1,'{}')").run();
 try{const s=new RequirementReviewStore(db);const req={id:"a",text:"same feature",acceptanceCriteria:["condition"],sourceRefs:[{documentSnapshotId:"d",blockId:"b",quoteHash:"h"}]};const set={id:"set",projectId:"p",items:[req,{...req,id:"b"},{...req,id:"c"}]} as RequirementSet;
 const report={id:"r",projectId:"p",findings:[{requirementId:"a",status:"MISSING"},{requirementId:"b",status:"MISSING"},{requirementId:"c",status:"IMPLEMENTED"}]} as AnalysisReport;
 db.transaction(()=>s.reconcile(report,set,{"d:b":{resourceId:"doc",quoteHash:"h"}},s.token("p")))();expect(s.list("p")).toHaveLength(1);expect(s.list("p")[0]).toMatchObject({requirementId:"a",state:"PENDING"});
 }finally{db.close();}
});
