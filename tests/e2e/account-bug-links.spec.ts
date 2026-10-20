import {test,expect,_electron as electron} from "@playwright/test";
import {createServer} from "node:http";
import {once} from "node:events";
import {mkdtemp,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {execFileSync} from "node:child_process";
import {gitFixture} from "../../packages/testkit/src/git-fixture";

test("saves independent Jira project connections and auto-links one Trinity account with strict analysis mapping",async()=>{
 test.setTimeout(150000);
 const data=await mkdtemp(join(tmpdir(),"account-bug-links-"));const f=await gitFixture();const future=await gitFixture();
 let jiraOffline=false,remoteProject="P2",modelCalls=0;
 const server=createServer(async(req,res)=>{
  const path=new URL(req.url!,"http://localhost").pathname;const reply=(value:unknown)=>res.end(JSON.stringify(value));
  if(path==="/")return res.end('<script src="static/js/app.js"></script>');
  if(path==="/static/js/app.js")return res.end('a=r.enc.Utf8.parse("0123456789abcdef"),b=r.enc.Utf8.parse("fedcba9876543210");function x(t){return r.AES.encrypt(t,a)}');
  res.setHeader("content-type","application/json");
  if(path==="/trinity/security/login/ldap"){
   let body="";for await(const part of req)body+=part;
   return reply({code:200,data:{token:`token-${new URLSearchParams(body).get("uid")}`}});
  }
  const account=req.headers["x-token"]==="token-bob"?"uid-bob":"uid-alice";
  if(path==="/trinity/sys/user/userinfo")return reply({code:200,data:{uid:account,apiVersion:"Trinity V8.16.0",isGray:null}});
  if(path==="/trinity/quality/bugRedux/getBugsByMultiProjects"){
   expect(req.headers.isgray).toBe("null");expect(req.headers.apiversion).toBe("Trinity V8.16.0");
   let text="";for await(const part of req)text+=part;const body=JSON.parse(text);
   expect(body).toMatchObject({mode:"assignToMe",userId:account,allProjects:true,projectIds:[]});
   return reply({code:200,data:{page:{total:2,records:[{bugId:"T-1"},{bugId:"T-2"}]}}});
  }
  if(path==="/trinity/quality/bugRedux/getByBugId"){
   expect(req.headers.isgray).toBe("null");expect(req.headers.apiversion).toBe("Trinity V8.16.0");
   const key=new URL(req.url!,"http://localhost").searchParams.get("bugId")!;
   return reply({code:200,data:{id:key,bugId:key,workitemId:`W-${key}`,projectId:key==="T-1"?remoteProject:"UNMATCHED",assigneeId:account,title:key==="T-1"?"Mapped bug":"Unmatched bug",description:"fixture",status:"Open",updateTime:"now"}});
  }
  if(path.startsWith("/rest/")){
   if(jiraOffline){res.writeHead(503);return reply({});}
   if(path.endsWith("/myself"))return reply({name:"alice"});
   if(path.endsWith("/project"))return reply([{key:"A",name:"项目甲"},{key:"B",name:"项目乙"}]);
   if(path.endsWith("/issuetype"))return reply([{id:"1",name:"Bug"}]);
   if(path.endsWith("/search"))return reply({startAt:0,total:0,issues:[]});
  }
  if(path.includes("chat/completions")){modelCalls++;res.writeHead(500);return reply({});}
  res.writeHead(404);reply({});
 });server.listen(0,"127.0.0.1");await once(server,"listening");const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 let app:Awaited<ReturnType<typeof electron.launch>>|undefined;
 try{
  app=await electron.launch({executablePath:process.env.PLATFORM_EXECUTABLE!,args:[],env:{...process.env,PLATFORM_E2E:"1",PLATFORM_DATA_DIR:data,HOME:data,USERPROFILE:data,APPDATA:data}});const page=await app.firstWindow();
  const ids=await page.evaluate(async({base,paths})=>{
   const ai=await window.platform.saveAIProfile({kind:"api",name:"Default",baseUrl:base+"/v1",model:"fixture",outboundEnabled:true});if(!ai.ok)throw new Error(ai.error.message);
   const ids:string[]=[];for(let i=0;i<paths.length;i++){const r=await window.platform.saveProject({name:`Code ${i===0?"A":"B"}`,enabled:true,repositories:[{path:paths[i],branch:"main",remoteName:"origin",role:"main"}],documents:[],issueBindings:[],aiProfileId:null});if(!r.ok)throw new Error(r.error.message);ids.push(r.value.id);}return ids;
  },{base,paths:[f.analysis,f.seed]});
  await page.getByRole("button",{name:"设置",exact:true}).click();
  const panel=page.locator("section.work-panel").filter({has:page.getByRole("heading",{name:"Jira 与 Trinity 登录",exact:true})});
  for(const [key,title] of [["A","项目甲"],["B","项目乙"]]){
   await panel.getByLabel("Jira 登录方式").selectOption("account");await panel.getByLabel("连接名称",{exact:true}).fill(`Jira ${key}`);await panel.getByLabel("平台地址",{exact:true}).fill(base);await panel.getByLabel("登录账号",{exact:true}).fill("alice");await panel.getByLabel("登录密码",{exact:true}).fill("fixture-password");
   await panel.getByRole("button",{name:"登录并读取 Jira 项目",exact:true}).click();const picker=panel.getByRole("combobox",{name:"Jira 项目",exact:true});await expect(picker).toBeEnabled();await picker.fill(title);await panel.getByRole("option",{name:`${title}（${key}）`,exact:true}).click();await panel.getByRole("button",{name:"保存 Jira 连接",exact:true}).click();
   await expect(panel.locator(".report-list-item").filter({hasText:`Jira ${key}`})).toContainText(`（${key}）`);
  }
  const connectionIds=await page.evaluate(async()=>{const r=await window.platform.getIssueConnections();if(!r.ok)throw new Error(r.error.message);return r.value.map(c=>c.id);});
  await panel.locator(".report-list-item").filter({hasText:"Jira A"}).getByRole("button",{name:"关联项目",exact:true}).click();
  const choice=page.getByRole("dialog",{name:"选择关联项目",exact:true});await choice.getByLabel("代码项目").selectOption(ids[0]);await choice.getByRole("button",{name:"配置关联",exact:true}).click();
  const links=page.getByRole("dialog",{name:"管理项目关联",exact:true});await expect(links.getByRole("combobox",{name:"Jira 项目",exact:true})).toHaveCount(0);await expect(links.getByLabel("Jira 项目连接")).toHaveValue(connectionIds[0]);await links.getByRole("button",{name:"保存关联",exact:true}).click();await expect(links).toHaveCount(0);
  await panel.getByLabel("BUG 平台").selectOption("trinity");await panel.getByLabel("连接名称",{exact:true}).fill("Current Trinity");await panel.getByLabel("平台地址",{exact:true}).fill(base);await panel.getByLabel("登录账号",{exact:true}).fill("alice");await panel.getByLabel("登录密码",{exact:true}).fill("fixture-password");await panel.getByRole("button",{name:"登录并保存平台连接",exact:true}).click();
  await expect(panel.getByText(/Trinity 已自动关联所有代码项目/)).toBeVisible();const trinityCard=panel.locator(".report-list-item").filter({hasText:"Current Trinity"});await expect(trinityCard.getByRole("button",{name:"关联项目",exact:true})).toHaveCount(0);
  const state=()=>page.evaluate(async()=>{const r=await window.platform.listProjects();if(!r.ok)throw new Error(r.error.message);return r.value;});
  expect((await state()).every(p=>p.issueBindings.some(b=>b.platform==="trinity"&&b.owner==="uid-alice"&&b.scopeMode==="account"))).toBe(true);
  const futureId=await page.evaluate(async path=>{const r=await window.platform.saveProject({name:"Code C",enabled:true,repositories:[{path,branch:"main",remoteName:"origin",role:"main"}],documents:[],issueBindings:[],aiProfileId:null});if(!r.ok)throw new Error(r.error.message);return r.value.id;},future.analysis);
  expect((await state()).find(p=>p.id===futureId)!.issueBindings[0].platform).toBe("trinity");
  await page.reload();await page.getByRole("button",{name:"项目管理",exact:true}).click();
  await page.locator("section").filter({has:page.getByRole("heading",{name:"Code B",exact:true})}).getByRole("button",{name:"管理关联",exact:true}).click();
  await expect(links.getByRole("heading",{name:"Trinity 账号 · 自动关联",exact:true})).toBeVisible();await expect(links.getByLabel("负责人",{exact:true})).toHaveCount(0);await expect(links.getByRole("button",{name:"添加 Trinity 范围"})).toHaveCount(0);
  await links.getByLabel("Trinity 项目 ID（逗号分隔）",{exact:true}).fill("P2");await links.getByRole("button",{name:"保存关联",exact:true}).click();await expect(links).toHaveCount(0);
  await page.getByRole("button",{name:"BUG 工作台",exact:true}).click();await page.getByLabel("当前 BUG 项目").selectOption(ids[0]);await page.getByRole("button",{name:"刷新问题单",exact:true}).click();
  const mapped=page.locator("article").filter({has:page.getByRole("link",{name:"T-1",exact:true})});const unmatched=page.locator("article").filter({has:page.getByRole("link",{name:"T-2",exact:true})});
  await expect(mapped).toContainText("匹配代码项目：Code B");await expect(mapped.getByRole("button",{name:"更新代码并预分析",exact:true})).toBeEnabled();await expect(unmatched).toContainText("当前问题与所有项目不匹配，无法进行预分析");await expect(unmatched.getByRole("button",{name:"更新代码并预分析",exact:true})).toBeDisabled();
  const oldSnapshot=await page.evaluate(async id=>{const r=await window.platform.getBugWorkspace(id);if(!r.ok)throw new Error(r.error.message);const item=r.value.issues.find(i=>i.key==="T-2")!;const rejected=await window.platform.analyzeBug(id,item.id);const tasks=await window.platform.listTasks();if(!tasks.ok)throw new Error(tasks.error.message);return {rejected,tasks:tasks.value,snapshot:r.value.issues.find(i=>i.key==="T-1")!.id};},ids[0]);
  expect(oldSnapshot.rejected.ok).toBe(false);expect(oldSnapshot.tasks).toEqual([]);
  const head=()=>execFileSync("git",["rev-parse","HEAD"],{cwd:f.seed,encoding:"utf8",windowsHide:true}).trim();const before=head();
  remoteProject="changed-after-list";await mapped.getByRole("button",{name:"更新代码并预分析",exact:true}).click();
  await expect.poll(async()=>page.evaluate(async()=>{const r=await window.platform.listTasks();return r.ok?r.value[0]?.error?.code:"failed";}),{timeout:20000}).toBe("ISSUE_PROJECT_UNMATCHED");
  expect(head()).toBe(before);expect(modelCalls).toBe(0);
  await page.evaluate(async base=>{const r=await window.platform.saveIssueConnection({kind:"trinity",platform:"trinity",name:"Replacement Trinity",baseUrl:base,username:"bob",bypassProxy:true},"fixture-password");if(!r.ok)throw new Error(r.error.message);},base);
  expect((await state()).every(p=>p.issueBindings.some(b=>b.platform==="trinity"&&b.owner==="uid-bob"))).toBe(true);
  const accountCount=await page.evaluate(async()=>{const r=await window.platform.getIssueConnections();return r.ok?r.value.filter(c=>c.platform==="trinity").length:-1;});expect(accountCount).toBe(1);
  const stale=await page.evaluate(async({id,snapshot})=>window.platform.analyzeBug(id,snapshot),{id:ids[0],snapshot:oldSnapshot.snapshot});expect(stale.ok).toBe(false);
  jiraOffline=true;await page.reload();await page.getByRole("button",{name:"项目管理",exact:true}).click();await page.locator("section").filter({has:page.getByRole("heading",{name:"Code A",exact:true})}).getByRole("button",{name:"管理关联",exact:true}).click();
  await links.getByLabel("Jira 项目连接").selectOption(connectionIds[1]);await links.getByRole("button",{name:"保存关联",exact:true}).click();await expect(links).toHaveCount(0);expect((await state()).find(p=>p.id===ids[0])!.issueBindings.find(b=>b.platform!=="trinity")?.projectKey).toBe("B");
  await page.screenshot({path:test.info().outputPath("account-bug-links.png")});
 }finally{await app?.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await f.dispose();await future.dispose();await rm(data,{recursive:true,force:true});}
});
