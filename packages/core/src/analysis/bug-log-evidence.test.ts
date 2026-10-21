import {expect,it} from "vitest";
import {AnalysisPipeline} from "./analysis-pipeline";
import {ContextReader} from "../context/context-reader";
import {SearchService} from "../search/search-service";
import {RequirementService} from "../requirements/requirement-service";
import type {IssueSnapshot} from "../../../contracts/src/issues";
it.each([true,false])("requires actually read log evidence alongside current-code evidence (read=%s)",async readLog=>{
 const logSet={id:"logs",scope:{platform:"trinity" as const,instanceUrl:"https://t",accountId:"a",remoteIssueId:"bug"},issueVersion:"v",generation:1,status:"READY" as const,attachments:[],files:[{id:"file",attachmentId:"a",path:"log.txt",originalHash:"original",contentHash:"text",size:3,encoding:"utf-8",lineCount:1,status:"PARSED" as const,error:null}],manifestHash:"manifest",error:null,updatedAt:"now"};
 const reader=new ContextReader({id:"context",projectId:"project",configRevision:1,issueSnapshotId:"issue",issueLogs:{id:"logs",manifestHash:"manifest"},repositories:[{kind:"worktree",bindingId:"repo",canonicalPath:"D:/fixture",branch:"main",commit:null,capturedAt:"now",manifestHash:"code-manifest",dirty:true,files:[{path:"feature.ts",contentHash:"code",size:15}],excluded:[]}],documents:[],createdAt:"now",limitations:[]},{getDocument(){throw new Error("unused");},getIssueLogSet:()=>logSet},{readFile:async()=>{throw new Error("must not read Git");}},{get:async()=>Buffer.from("current code"),readLines:async()=>({text:"observed error",endLine:1})});
 await expect(reader.readLog("other-context","file",1,1)).rejects.toMatchObject({code:"LOG_DENIED"});
 let round=0;
 const model={version:"fixture",identity:{profileId:"model",kind:"api" as const,name:"model",configuredModel:"fixture",location:"local",configurationHash:"0".repeat(64)},complete:async(messages:{role:string;content:string|null}[])=>{
  if(round++===0)return {content:null,toolCalls:[{id:"code",name:"readCode",arguments:JSON.stringify({bindingId:"repo",path:"feature.ts",startLine:1,endLine:1})},...(readLog?[{id:"log",name:"readLog",arguments:JSON.stringify({logSetId:"logs",fileId:"file",startLine:1,endLine:1})}]:[])]};
  const evidence=messages.filter(m=>m.role==="tool").map(m=>JSON.parse(m.content!).evidence).filter(Boolean);
  return {content:JSON.stringify({reproduction:["fixture"],facts:[{text:"Current code and observed log",evidenceIds:evidence.map(e=>e.id)}],hypotheses:[],missingInformation:[]})};
 }};
 const pipeline=new AnalysisPipeline(reader,new SearchService({replaceSearchChunks(){},searchChunks(){return [];}}),new RequirementService({saveRequirementSet(){},latestRequirementSet(){return null;}}),model);
 const task={id:"task",projectId:"project",projectName:"P",kind:"ANALYZE_BUG" as const,status:"RUNNING" as const,attempt:1,createdAt:"now",updatedAt:"now",error:null,contextSnapshotId:null};
 const result=pipeline.preanalyze(task,{id:"issue",projectId:"project",versions:[],warnings:[],attachments:[]} as unknown as IssueSnapshot,new AbortController().signal);
 if(readLog){const report=await result;expect(report.schemaVersion).toBe(2);expect(report.evidenceRefs.map(e=>e.kind)).toEqual(expect.arrayContaining(["log","worktree-code"]));}
 else await expect(result).rejects.toMatchObject({code:"OUTPUT_INVALID"});
});
