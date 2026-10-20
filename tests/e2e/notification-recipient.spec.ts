import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gitFixture } from "../../packages/testkit/src/git-fixture";

test("selects a same-name recipient, reports expired search authorization, and sends to the saved account after restart without user lookup",async()=>{
  test.setTimeout(90000);
  const data=await mkdtemp(join(tmpdir(),"notification-recipient-"));const fixture=await gitFixture();let count=1;
  const server=createServer((req,res)=>{
    res.setHeader("content-type","application/json");const path=new URL(req.url!,"http://localhost").pathname;
    if(path.endsWith("/myself"))return res.end(JSON.stringify({name:"alice"}));
    if(path.endsWith("/project"))return res.end(JSON.stringify([{key:"A",name:"Project A"}]));
    if(path.endsWith("/issuetype"))return res.end(JSON.stringify([{id:"1",name:"Bug"}]));
    if(path.endsWith("/search"))return res.end(JSON.stringify({startAt:0,total:count,issues:Array.from({length:count},(_,i)=>({id:String(i+1),key:`A-${i+1}`,self:`${base}/rest/api/2/issue/A-${i+1}`,fields:{project:{key:"A"},assignee:{name:"alice"},issuetype:{id:"1"},summary:"Bug",description:"fixture",status:{name:"分析中"},updated:"now",versions:[],comment:{total:0,comments:[]},attachment:[]}}))}));
    res.writeHead(404).end("{}");
  });server.listen(0,"127.0.0.1");await once(server,"listening");const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const exe=join(data,"lark-fixture.exe");let app:Awaited<ReturnType<typeof electron.launch>>|undefined;
  const notifications=async()=>{
    try{return await readFile(join(data,"notifications.txt"),"utf8");}
    catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return "";throw error;}
  };
  const launch=()=>electron.launch({executablePath:process.env.PLATFORM_EXECUTABLE!,args:[],env:{...process.env,PLATFORM_DATA_DIR:join(data,"app"),PLATFORM_E2E:"1",HOME:data,USERPROFILE:data,APPDATA:data}});
  try {
    execFileSync(join(process.env.SystemRoot??"C:/Windows","Microsoft.NET/Framework64/v4.0.30319/csc.exe"),["/nologo","/codepage:65001",`/out:${exe}`,resolve("packages/testkit/fixtures/issues/LarkRecipientFixture.cs")],{windowsHide:true,stdio:"pipe"});
    app=await launch();let page=await app.firstWindow();
    const projectId=await page.evaluate(async({base,repo,exe})=>{
      function take<T>(r:{ok:true;value:T}|{ok:false;error:{message:string}}):T{if(!r.ok)throw new Error(r.error.message);return r.value;}
      const jira=take(await window.platform.saveIssueConnection({kind:"jira-http",platform:"jira-dc",name:"Jira",baseUrl:base,username:"alice",bypassProxy:true,jiraProject:{key:"A",name:"Project A",owner:"alice",issueTypeIds:["1"]}},"fixture-password"));
      take(await window.platform.saveCliConfiguration({larkExecutable:exe,identity:"user"}));
      const project=take(await window.platform.saveProject({name:"通知项目",enabled:true,repositories:[{path:repo,branch:"main",remoteName:"origin",role:"main"}],documents:[],aiProfileId:null,issueBindings:[{id:"jira",connectionId:jira.id,platform:"jira-dc",instanceUrl:base,projectKey:"A",owner:"alice",issueTypeIds:["1"]}]}));
      return project.id;
    },{base,repo:fixture.analysis,exe});
    await page.getByRole("button",{name:"BUG 工作台",exact:true}).click();await page.getByRole("button",{name:"刷新问题单",exact:true}).click();
    await expect(page.getByRole("link",{name:"A-1",exact:true})).toBeVisible();await page.getByText(/定时查询与飞书提醒 ·/).click();
    await page.getByLabel("飞书接收人姓名",{exact:true}).fill("授权失效");await page.getByRole("button",{name:"搜索接收人",exact:true}).click();
    await expect(page.getByRole("alert")).toContainText("lark-cli auth login");
    await page.getByLabel("飞书接收人姓名",{exact:true}).fill("周贺棋");await page.getByRole("button",{name:"搜索接收人",exact:true}).click();
    await expect(page.getByRole("radio")).toHaveCount(2);
    await expect(page.getByRole("button",{name:"保存飞书接收人",exact:true})).toBeDisabled();
    await page.getByRole("radio",{name:/部门二.*ou_two/}).check();await page.getByRole("button",{name:"保存飞书接收人",exact:true}).click();
    await expect(page.getByText(/飞书接收人已保存；/)).toBeVisible();await expect(page.getByText(/通知接收人：周贺棋 · 部门二 · ou_two/)).toBeVisible();
    await page.bringToFront();await page.screenshot({path:test.info().outputPath("selected-feishu-recipient.png")});
    expect(await readFile(join(data,"cli-calls.txt"),"utf8")).not.toContain("+messages-send");
    count=2;await page.getByRole("button",{name:"刷新问题单",exact:true}).click();await expect.poll(notifications).toContain("A-2");
    await app.close();app=undefined;await writeFile(join(data,"user-auth-expired.flag"),"expired");count=3;
    app=await launch();page=await app.firstWindow();
    await page.evaluate(async projectId=>{const r=await window.platform.refreshBugWorkspace(projectId);if(!r.ok)throw new Error(r.error.message);},projectId);
    await expect.poll(notifications).toContain("A-3");
    const lines=(await readFile(join(data,"notifications.txt"),"utf8")).trim().split("\n");expect(lines).toHaveLength(2);
    expect(lines.every(line=>line.includes("--user-id|ou_two")&&line.includes("--as|bot"))).toBe(true);
    expect((await readFile(join(data,"cli-calls.txt"),"utf8")).split("\n").some(line=>line.startsWith("api|"))).toBe(false);
    const status=await page.evaluate(async()=>{const r=await window.platform.getIssueMonitor();if(!r.ok)throw new Error(r.error.message);return r.value;});
    expect(status.recipient?.openId).toBe("ou_two");expect(status.pendingCount).toBe(0);
  } finally {await app?.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await fixture.dispose();await rm(data,{recursive:true,force:true});}
});
