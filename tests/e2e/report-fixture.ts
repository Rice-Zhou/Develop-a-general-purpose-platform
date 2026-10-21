import {_electron as electron} from "@playwright/test";
import {mkdtemp,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
export async function reportFixture(){
 const root=await mkdtemp(join(tmpdir(),"report-reading-"));const app=await electron.launch({executablePath:process.env.PLATFORM_EXECUTABLE!,args:[],env:{...process.env,PLATFORM_E2E:"1",PLATFORM_DATA_DIR:root,APPDATA:root,HOME:root,USERPROFILE:root}});
 const page=await app.firstWindow(); await page.waitForLoadState();
 await app.evaluate(({ipcMain})=>{
  const handlers=(ipcMain as unknown as {_invokeHandlers:Map<string,(event:unknown,input:{method:string;params:Record<string,string>})=>unknown>})._invokeHandlers;const original=handlers.get("platform:request")!;ipcMain.removeHandler("platform:request");
  const pid="11111111-1111-4111-8111-111111111111",bid="22222222-2222-4222-8222-222222222222",cid="33333333-3333-4333-8333-333333333333";
  const project={id:pid,name:"Code A",enabled:true,revision:1,repositories:[],documents:[],issueBindings:[{id:bid,connectionId:cid}],aiProfileId:null};
  const issues=[1,2,3].map(n=>({id:`00000000-0000-4000-8000-00000000000${n}`,projectId:pid,bindingId:bid,connectionId:cid,remoteId:`${n}`,key:`A-${n}`,title:`Problem ${n}`,webUrl:`https://example.com/A-${n}`,status:"Open",ownerId:"me",versions:[],comments:[],warnings:[],description:"",updatedAt:"now",analysisProjectId:pid,reportSummaries:n===3?[]:[{analysisProjectId:pid,connectionId:cid,remoteId:`${n}`,reportId:`44444444-4444-4444-8444-44444444444${n}`,taskId:`55555555-5555-4555-8555-55555555555${n}`,createdAt:"2026-10-21T00:00:00Z"}]}));
  ipcMain.handle("platform:request",async(event,input)=>{
   const ok=(value:unknown)=>({ok:true,value});
   if(input.method==="listProjects")return ok([project]);if(input.method==="listTasks")return ok([]);
   if(input.method==="getBugWorkspace")return ok({issues,sources:[],reports:[]});
   if(input.method==="getBugReport"){
    const n=Number(input.params.reportId.slice(-1));const evidenceRefs=[1,2].map(i=>({kind:"code",id:`ev-${i}`,projectId:pid,contextSnapshotId:cid,bindingId:bid,commit:"abc",path:`file${i}.ts`,startLine:1,endLine:2,snippetHash:"hash"}));
    return ok({issue:issues[n-1],context:{repositories:[]},report:{id:input.params.reportId,projectId:pid,contextSnapshotId:cid,createdAt:"now",reproduction:["Reproduce fixture"],facts:[{text:"Code fact",evidenceIds:["ev-1"]}],hypotheses:[{text:`Cause ${n}`,supportEvidenceIds:["ev-1"],counterEvidenceIds:[],nextSteps:["Debug next step"]}],missingInformation:["Missing fixture"],checkedScope:["Scope"],limitations:[],evidenceRefs,executorConfiguration:{name:"Model"},usage:null}});
   }
   if(input.method==="readEvidence"){const ref=input.params.evidence as unknown as {id:string};await new Promise(r=>setTimeout(r,ref.id==="ev-1"?150:20));return ok({text:`Content ${ref.id}`,evidence:ref});}
   return original(event,input);
  });
 });await page.reload();await page.getByRole("button",{name:"BUG 工作台",exact:true}).click();
 return {app,page,dispose:async()=>{await app.close();await rm(root,{recursive:true,force:true});}};
}
