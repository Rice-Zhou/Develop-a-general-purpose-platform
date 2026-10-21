import {it,expect} from "vitest";
import {mkdtemp,rm} from "node:fs/promises";import {tmpdir} from "node:os";import {join} from "node:path";import {createHash} from "node:crypto";
import {DataStore} from "./database";
import type {Task,ContextSnapshot} from "../../contracts/src/models";
import type {AnalysisReport} from "../../contracts/src/analysis";
import type {RequirementSet} from "../../contracts/src/requirements";
it("saves context before the requirement FK and rolls back the entire audit when reconciliation fails",async()=>{
 const root=await mkdtemp(join(tmpdir(),"audit-atomic-"));const store=await DataStore.open(join(root,"db"));
 try{
 store.saveProject({id:"p",name:"P",revision:1,enabled:true,repositories:[],documents:[],issueBindings:[],aiProfileId:null,updatedAt:"now"});
 const hash=createHash("sha256").update("source").digest("hex");
 store.saveDocument({schemaVersion:1,id:"doc",projectId:"p",bindingId:"resource",kind:"docx",sourceLocator:"D:/r.docx",contentHash:hash,sourceRevision:null,parserVersion:"1",fetchedAt:"now",blocks:[{id:"block",kind:"paragraph",text:"source",headingPath:[],anchor:{label:"source"},warnings:[]}],warnings:[]});
 const context:ContextSnapshot={id:"ctx",projectId:"p",configRevision:1,repositories:[],documents:[{id:"doc",bindingId:"resource",kind:"docx",contentHash:hash}],createdAt:"now",limitations:[]};
 const task:Task={id:"t",projectId:"p",projectName:"P",kind:"AUDIT_REQUIREMENTS",status:"RUNNING",attempt:1,attemptId:"attempt",createdAt:"now",updatedAt:"now",error:null,contextSnapshotId:null,reviewRunToken:{decisionSequence:0}};store.saveTask(task);
 const set:RequirementSet={schemaVersion:1,id:"set",projectId:"p",contextSnapshotId:"ctx",revision:1,createdAt:"now",items:[{id:"r",text:"feature",acceptanceCriteria:["accepted"],sourceRefs:[{documentSnapshotId:"doc",blockId:"block",quoteHash:hash}],reviewed:false,clarification:""}]};
 const report:AnalysisReport={schemaVersion:1,id:"report",projectId:"p",taskId:"t",attemptId:"attempt",contextSnapshotId:"ctx",requirementSetId:"set",inputSnapshotIds:["ctx"],executorVersion:"test",executorConfiguration:{profileId:"fixture",kind:"api",name:"fixture",configuredModel:"test",location:"test",configurationHash:hash},templateVersion:"1",createdAt:"now",findings:[{requirementId:"r",status:"UNKNOWN",explanation:"needs code",evidenceIds:[],checkedScope:["src"],verification:"STATIC"}],evidenceRefs:[],limitations:[],sourceGaps:[],parseWarnings:[],usage:null};
 store.completeRequirementAudit(task,context,set,report);
 expect(store.getTask("t").status).toBe("SUCCEEDED");expect(store.getRequirementSet("p","set").id).toBe("set");
 const nextTask={...task,id:"t2"};store.saveTask(nextTask);const nextContext={...context,id:"ctx2"};const nextSet={...set,id:"set2",revision:2,contextSnapshotId:"ctx2",items:set.items.map(i=>({...i,sourceRefs:[{...i.sourceRefs[0],blockId:"invalid"}]}))};
 expect(()=>store.completeRequirementAudit(nextTask,nextContext,nextSet,{...report,id:"report2",taskId:"t2",contextSnapshotId:"ctx2",requirementSetId:"set2"})).toThrow(/原文/);
 expect(store.getTask("t2").status).toBe("RUNNING");expect(store.listReports("p")).toHaveLength(1);expect(store.latestRequirementSet("p")?.id).toBe("set");expect(()=>store.getContext("ctx2")).toThrow();
 }finally{store.close();await rm(root,{recursive:true,force:true});}
});
