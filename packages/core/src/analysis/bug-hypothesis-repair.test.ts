import {expect,it} from "vitest";
import {AnalysisPipeline} from "./analysis-pipeline";
import {ContextReader} from "../context/context-reader";
import {SearchService} from "../search/search-service";
import {RequirementService} from "../requirements/requirement-service";
import type {IssueSnapshot} from "../../../contracts/src/issues";
import type {ModelMessage} from "./ports";
it("repairs a log-only hypothesis with a specific item path and acquired code inventory",async()=>{
 const logSet={id:"logs",scope:{platform:"trinity" as const,instanceUrl:"https://t",accountId:"a",remoteIssueId:"bug"},issueVersion:"v",generation:1,status:"READY" as const,attachments:[],files:[{id:"file",attachmentId:"a",path:"log.txt",originalHash:"original",contentHash:"text",size:3,encoding:"utf-8",lineCount:1,status:"PARSED" as const,error:null}],manifestHash:"manifest",error:null,updatedAt:"now"};
 const reader=new ContextReader({id:"context",projectId:"project",configRevision:1,issueSnapshotId:"issue",issueLogs:{id:"logs",manifestHash:"manifest"},repositories:[{kind:"worktree",bindingId:"repo",canonicalPath:"D:/fixture",branch:"main",commit:null,capturedAt:"now",manifestHash:"code-manifest",dirty:true,files:[{path:"feature.ts",contentHash:"code",size:15}],excluded:[]}],documents:[],createdAt:"now",limitations:[]},{getDocument(){throw new Error("unused");},getIssueLogSet:()=>logSet},{readFile:async()=>{throw new Error("must not read Git");}},{get:async()=>Buffer.from("current code"),readLines:async()=>({text:"observed error",endLine:1})});
 let round=0;
 const model={version:"fixture",identity:{profileId:"model",kind:"api" as const,name:"model",configuredModel:"fixture",location:"local",configurationHash:"0".repeat(64)},complete:async(messages:ModelMessage[])=>{
  if(round++===0){expect(JSON.parse(messages[1].content!).goal).toContain("每条候选原因");return {content:null,toolCalls:[{id:"code",name:"readCode",arguments:JSON.stringify({bindingId:"repo",path:"feature.ts",startLine:1,endLine:1})},{id:"log",name:"readLog",arguments:JSON.stringify({logSetId:"logs",fileId:"file",startLine:1,endLine:1})}]};}
  const evidence=messages.filter(m=>m.role==="tool").map(m=>JSON.parse(m.content!).evidence);
  const code=evidence.find(e=>e.kind==="worktree-code"),log=evidence.find(e=>e.kind==="log");
  if(round===3){const repair=JSON.parse(messages.at(-1)!.content!);expect(repair.error).toContain("hypotheses[0]");expect(repair.availableEvidence).toEqual(expect.arrayContaining([{id:code.id,kind:"worktree-code"},{id:log.id,kind:"log"}]));expect(repair.instruction).toContain("missingInformation");}
  return {content:JSON.stringify({reproduction:["fixture"],facts:[{text:"Known code and log",evidenceIds:[code.id,log.id]}],hypotheses:round===2?[{text:"unsupported theory",supportEvidenceIds:[log.id],counterEvidenceIds:[],nextSteps:["investigate"]}]:[],missingInformation:round===3?["unsupported theory needs code investigation"]:[]})};
 }};
 const pipeline=new AnalysisPipeline(reader,new SearchService({replaceSearchChunks(){},searchChunks(){return [];}}),new RequirementService({saveRequirementSet(){},latestRequirementSet(){return null;}}),model);
 const task={id:"task",projectId:"project",projectName:"P",kind:"ANALYZE_BUG" as const,status:"RUNNING" as const,attempt:1,createdAt:"now",updatedAt:"now",error:null,contextSnapshotId:null};
 const report=await pipeline.preanalyze(task,{id:"issue",projectId:"project",versions:[],warnings:[],attachments:[]} as unknown as IssueSnapshot,new AbortController().signal);
 expect(round).toBe(3);expect(report.hypotheses).toEqual([]);expect(report.missingInformation).toContain("unsupported theory needs code investigation");expect(report.evidenceRefs.map(e=>e.kind)).toEqual(expect.arrayContaining(["log","worktree-code"]));
});
