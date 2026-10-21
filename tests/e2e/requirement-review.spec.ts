import {test,expect,_electron as electron} from "@playwright/test";
import {mkdtemp,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
test("requires explicit human classification and never leaks unrelated bug errors",async()=>{
 const data=await mkdtemp(join(tmpdir(),"review-ui-"));const app=await electron.launch({executablePath:process.env.PLATFORM_EXECUTABLE!,args:[],env:{...process.env,PLATFORM_E2E:"1",PLATFORM_DATA_DIR:data,APPDATA:data}});
 try{const page=await app.firstWindow();await page.waitForLoadState();await app.evaluate(({ipcMain})=>{
 const handlers=(ipcMain as unknown as {_invokeHandlers:Map<string,(e:unknown,r:{method:string;params:Record<string,string>})=>unknown>})._invokeHandlers;const original=handlers.get("platform:request")!;ipcMain.removeHandler("platform:request");
 const id="11111111-1111-4111-8111-111111111111";const project={id,name:"代码A",enabled:true,revision:1,aiProfileId:"ai",issueBindings:[],repositories:[],documents:[],updatedAt:"now"};
 let state="PENDING",revision=1;ipcMain.handle("platform:request",(e,r)=>{const ok=(value:unknown)=>({ok:true,value});
 if(r.method==="listProjects")return ok([project,{...project,id:"33333333-3333-4333-8333-333333333333",name:"代码B"}]);if(r.method==="getAIProfiles")return ok([{id:"ai",name:"AI",model:"fixture",kind:"api",outboundEnabled:true,baseUrl:"http://fixture",hasCredential:false}]);if(r.method==="auditRequirements")return new Promise(resolve=>setTimeout(()=>resolve(ok({id:"audit-task"})),700));if(r.method==="listTasks")return ok([{id:"bug",projectName:"代码A",attempt:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),contextSnapshotId:null,projectId:id,kind:"ANALYZE_BUG",status:"FAILED",error:{code:"BUG_ONLY",message:"不得泄漏到原文"}}]);
 if(r.method==="getWorkspace")return ok({context:null,documents:[],requirements:null,reports:[]});
 if(r.method==="getRequirementReviews"&&r.params.projectId!==id)return ok([]);if(r.method==="getRequirementReviews")return ok([{id:"22222222-2222-4222-8222-222222222222",projectId:id,fingerprint:"fp",state,revision,reportId:"r",requirementSetId:"s",requirementId:"q",historicalSource:false,updatedAt:"now",requirement:{text:"支持车门开关",acceptanceCriteria:["开关状态正确"],sourceRefs:[]},finding:{status:"MISSING",explanation:"疑似缺失",checkedScope:["src"],evidenceIds:[]},report:{evidenceRefs:[]}}]);
 if(r.method==="setRequirementReviewDecision"){state=r.params.action==="confirm-missing"?"CONFIRMED_MISSING":r.params.action==="complete"?"DONE":r.params.action==="restore"?"PENDING":"FALSE_POSITIVE";revision++;return ok({state,revision});}
 return original(e,r);});});
 await page.reload();await page.getByRole("button",{name:"需求核对",exact:true}).click();await expect(page.getByText("支持车门开关",{exact:true})).toBeVisible();await expect(page.getByRole("radio",{checked:true})).toHaveCount(0);await expect(page.getByText("不得泄漏到原文",{exact:true})).toHaveCount(0);
 await page.getByRole("radio",{name:"未完成",exact:true}).check();await expect(page.getByRole("checkbox",{name:"完成",exact:true})).toHaveCount(0);await page.getByRole("checkbox",{name:"确认未完成",exact:true}).check();await page.getByRole("checkbox",{name:"完成",exact:true}).check();await expect(page.getByText("没有待确认或未完成的需求",{exact:true})).toBeVisible();
 await page.getByText("已处理记录",{exact:true}).click();await page.getByRole("button",{name:"恢复",exact:true}).click();await page.getByRole("radio",{name:"误报",exact:true}).check();await expect(page.getByText("没有待确认或未完成的需求",{exact:true})).toBeVisible();
 await page.getByRole("button",{name:"AI 审核当前代码",exact:true}).click();await page.getByLabel("当前项目").selectOption({label:"代码B"});await expect(page.getByRole("button",{name:"AI 审核当前代码",exact:true})).toBeEnabled();
 }finally{await app.close();await rm(data,{recursive:true,force:true});}
});
