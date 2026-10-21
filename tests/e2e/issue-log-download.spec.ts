import {test,expect,_electron as electron} from "@playwright/test";
import {createServer} from "node:http";
import {once} from "node:events";
import {mkdtemp,rm,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {gitFixture,git} from "../../packages/testkit/src/git-fixture";
test("downloads issue logs before analyzing immutable dirty code and saves both evidence kinds",async()=>{
 test.setTimeout(120000);const data=await mkdtemp(join(tmpdir(),"issue-log-e2e-"));const f=await gitFixture();let downloads=0;let posts=0;let failed=false;
 const server=createServer(async(req,res)=>{
    if(req.method === "HEAD"){res.writeHead(405).end();return;}

  if(req.method==="HEAD"){res.writeHead(405).end();return;}
  const url=new URL(req.url!,"http://localhost");const reply=(v:unknown)=>{res.setHeader("content-type","application/json");res.end(JSON.stringify(v));};
  if(url.pathname==="/log"){downloads++;if(failed){res.writeHead(503).end();return;}return res.end("HVAC observed error\nmode=automatic\n");}
  const detail={id:"1",key:"A-1",self:base+"/rest/api/2/issue/1",fields:{project:{key:"A"},assignee:{name:"alice"},issuetype:{id:"1"},summary:"Log fixture",description:"Test current code",status:{name:"分析中"},updated:"v1",versions:[],comment:{total:0,comments:[]},attachment:[{id:"log",filename:"issue.log",mimeType:"text/plain",size:35,content:base+"/log"}]}};
  if(url.pathname.endsWith("/myself"))return reply({name:"alice"});if(url.pathname.endsWith("/project"))return reply([{key:"A",name:"Project A"}]);if(url.pathname.endsWith("/issuetype"))return reply([{id:"1",name:"Bug"}]);
  if(url.pathname.endsWith("/search"))return reply({startAt:0,total:1,issues:[detail]});if(url.pathname.includes("/rest/api/2/issue/"))return reply(detail);
  if(url.pathname.endsWith("/chat/completions")){
   posts++;let raw="";for await(const part of req)raw+=part;const body=JSON.parse(raw);const input=JSON.parse(body.messages[1].content);const rows=body.messages.filter((m:{role:string})=>m.role==="tool").map((m:{content:string})=>JSON.parse(m.content));
   if(!rows.length){const logs=input.materials.logs;const file=logs.files.find((v:{status:string})=>v.status==="PARSED");return reply({choices:[{message:{content:null,tool_calls:[{id:"code",type:"function",function:{name:"readCode",arguments:JSON.stringify({bindingId:input.materials.paths[0].bindingId,path:"feature.txt",startLine:1,endLine:1})}},{id:"bad-range",type:"function",function:{name:"readCode",arguments:JSON.stringify({bindingId:input.materials.paths[0].bindingId,path:"feature.txt",startLine:1,endLine:500})}},{id:"log",type:"function",function:{name:"readLog",arguments:JSON.stringify({logSetId:logs.id,fileId:file.fileId,startLine:1,endLine:2})}}]}}]});}
   expect(rows.find((v:{error?:{code:string}})=>v.error)?.error.code).toBe("LINE_RANGE_DENIED");
   const evidenceRows=rows.filter((v:{evidence?:unknown})=>v.evidence);
   expect(evidenceRows.find((v:{evidence:{kind:string}})=>v.evidence.kind==="worktree-code").text).toContain("dirty current implementation");expect(evidenceRows.find((v:{evidence:{kind:string}})=>v.evidence.kind==="log").text).toContain("HVAC observed error");
   return reply({choices:[{message:{content:JSON.stringify({reproduction:["fixture"],facts:[{text:"当前代码和日志已核对",evidenceIds:posts===2?["invented"]:evidenceRows.map((v:{evidence:{id:string}})=>v.evidence.id)}],hypotheses:[],missingInformation:[]})}}]});
  }res.writeHead(404).end();
 });server.listen(0,"127.0.0.1");await once(server,"listening");const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 let app:Awaited<ReturnType<typeof electron.launch>>|undefined;
 try{
  await writeFile(join(f.analysis,"feature.txt"),"dirty current implementation\n");const before=git(f.analysis,"rev-parse","HEAD");
  app=await electron.launch({executablePath:process.env.PLATFORM_EXECUTABLE!,args:[],env:{...process.env,PLATFORM_E2E:"1",PLATFORM_DATA_DIR:data,HOME:data,USERPROFILE:data,APPDATA:data}});const page=await app.firstWindow();
  const id=await page.evaluate(async({base,path})=>{
   const take=<T,>(value:{ok:true;value:T}|{ok:false;error:{message:string}}):T=>{if(!value.ok)throw new Error(value.error.message);return value.value;};
   take(await window.platform.saveAIProfile({kind:"api",name:"Model",model:"fixture",baseUrl:base+"/v1",outboundEnabled:true}));
   const connection=take(await window.platform.saveIssueConnection({kind:"jira-http",platform:"jira-dc",name:"Jira",username:"alice",baseUrl:base,bypassProxy:true,jiraProject:{key:"A",name:"Project A",owner:"alice",issueTypeIds:["1"]}},"fixture-password"));
   const project=take(await window.platform.saveProject({name:"Code",enabled:true,repositories:[{path,remoteName:"origin",branch:"main",role:"main"}],documents:[],issueBindings:[{id:crypto.randomUUID(),platform:"jira-dc",instanceUrl:base,projectKey:"A",owner:"alice",connectionId:connection.id,issueTypeIds:["1"]}],aiProfileId:null}));
   take(await window.platform.saveIssueMonitor({enabled:false,intervalMinutes:5,notificationsEnabled:false}));return project.id;
  },{base,path:f.analysis});
  await page.reload();await page.getByRole("button",{name:"BUG 工作台",exact:true}).click();await page.getByRole("button",{name:"刷新问题单",exact:true}).click();
  await expect(page.getByText("已下载并解析",{exact:false})).toBeVisible();expect(downloads).toBe(1);expect(posts).toBe(0);
  await page.getByRole("button",{name:"查看日志",exact:true}).click();await expect(page.locator("pre")).toContainText("HVAC observed error");
  await page.getByRole("button",{name:"基于当前代码预分析",exact:true}).click();
  await expect.poll(async()=>page.evaluate(async id=>{const r=await window.platform.listTasks(id);if(!r.ok)throw new Error(r.error.message);return r.value[0]?.status;},id),{timeout:60000}).toBe("SUCCEEDED");
  const report=await page.evaluate(async id=>{const r=await window.platform.getBugWorkspace(id);if(!r.ok)throw new Error(r.error.message);return r.value.reports[0];},id);expect(report.evidenceRefs.map(e=>e.kind)).toEqual(expect.arrayContaining(["log","worktree-code"]));expect(git(f.analysis,"rev-parse","HEAD")).toBe(before);expect(posts).toBe(3);
  const events=await page.evaluate(async id=>{const tasks=await window.platform.listTasks(id);if(!tasks.ok)throw new Error(tasks.error.message);const task=tasks.value.find(t=>t.kind==="ANALYZE_BUG")!;const events=await window.platform.getTaskEvents(task.id);if(!events.ok)throw new Error(events.error.message);return events.value;},id);expect(events.some(event=>event.message.includes("LINE_RANGE_DENIED"))).toBe(true);expect(events.filter(event=>event.message.includes("正在请求一次修正"))).toHaveLength(1);
  failed=true;const retry=await page.evaluate(async id=>{const r=await window.platform.getBugWorkspace(id);if(!r.ok)throw new Error(r.error.message);return window.platform.retryIssueLogs(id,r.value.issues[0].id);},id);expect(retry.ok).toBe(true);
  await expect(page.getByText(/下载或解析失败/)).toBeVisible();await expect(page.getByRole("link",{name:"A-1",exact:true})).toBeVisible();
  await page.screenshot({path:test.info().outputPath("issue-logs-current-code.png")});
 }finally{await app?.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await f.dispose();await rm(data,{recursive:true,force:true});}
});
