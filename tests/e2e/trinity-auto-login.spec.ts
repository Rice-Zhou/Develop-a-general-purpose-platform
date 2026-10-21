import {test,expect,_electron as electron} from "@playwright/test";
import {createServer} from "node:http";
import {once} from "node:events";
import {mkdtemp,readdir,readFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
test("optionally encrypts Trinity passwords, logs in on restart once, clears on disable and reports failed startup",async()=>{
 test.setTimeout(150000);const data=await mkdtemp(join(tmpdir(),"trinity-auto-login-"));let logins=0,fail=false;let releaseFirstLogin!:()=>void;const firstLoginGate=new Promise<void>(resolve=>{releaseFirstLogin=resolve;});
 const server=createServer(async(req,res)=>{
  const path=new URL(req.url!,"http://localhost").pathname;
  if(path==="/")return res.end('<script src="/static/js/app.js"></script>');
  if(path==="/static/js/app.js")return res.end('a=r.enc.Utf8.parse("0123456789abcdef"),b=r.enc.Utf8.parse("fedcba9876543210");function x(t){return r.AES.encrypt(t,a)}');
  res.setHeader("content-type","application/json");
  if(path==="/trinity/security/login/ldap"){logins++;if(logins===1)await firstLoginGate;for await(const part of req)void part;return res.end(JSON.stringify(fail?{code:50012}:{code:200,data:{token:`test-session-${logins}`}}));}
  if(path==="/trinity/sys/user/userinfo")return res.end(JSON.stringify({code:200,data:{uid:"uid-alice",apiVersion:"Trinity V8.16.0",isGray:null}}));
  if(path==="/rest/api/2/myself")return res.end(JSON.stringify({name:"alice"}));
  if(path==="/rest/api/2/project")return res.end(JSON.stringify([{key:"A",name:"Project A"}]));
  if(path==="/rest/api/2/issuetype")return res.end(JSON.stringify([{id:"1",name:"Bug"}]));
  res.writeHead(404).end();
 });server.listen(0,"127.0.0.1");await once(server,"listening");const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 let app:Awaited<ReturnType<typeof electron.launch>>|undefined;
 const launch=async()=>{app=await electron.launch({executablePath:process.env.PLATFORM_EXECUTABLE!,args:[],env:{...process.env,PLATFORM_E2E:"1",PLATFORM_DATA_DIR:data,HOME:data,USERPROFILE:data,APPDATA:data}});const page=await app.firstWindow();await expect.poll(()=>page.evaluate(async()=>{const r=await window.platform.getTrinityLoginStatus();return r.ok?r.value.state:"error";})).not.toBe("running");return page;};
 const stop=async()=>{await app?.close();app=undefined;};
 const vaultFiles=async()=>(await readdir(join(data,"credentials"))).filter(f=>f.endsWith(".bin"));
 try{
  let page=await launch();expect(logins).toBe(0);await page.getByRole("button",{name:"设置",exact:true}).click();
    await page.getByRole("button",{name:"新增 Jira 连接",exact:true}).click();
  const panel=()=>page.locator("section.work-panel").filter({has:page.getByRole("heading",{name:"Jira 与 Trinity 登录",exact:true})});
  await panel().getByLabel("BUG 平台").selectOption("trinity");const opt=()=>panel().getByRole("checkbox",{name:"在本机保存账号密码，并在启动时自动登录",exact:true});await expect(opt()).not.toBeChecked();
  await panel().getByLabel("连接名称",{exact:true}).fill("Remembered Trinity");await panel().getByLabel("平台地址",{exact:true}).fill(base);await panel().getByLabel("登录账号",{exact:true}).fill("alice");await panel().getByLabel("登录密码",{exact:true}).fill("fixture-private-password");await opt().check();await panel().getByRole("button",{name:"登录并保存平台连接",exact:true}).click();await expect(opt()).toBeDisabled();releaseFirstLogin();
  const card=()=>panel().locator(".report-list-item").filter({hasText:"Remembered Trinity"});await expect(card()).toContainText("自动登录已开启");
  const list=()=>page.evaluate(async()=>{const r=await window.platform.getIssueConnections();if(!r.ok)throw new Error(r.error.message);return r.value;});const id=(await list())[0].id;expect(JSON.stringify(await list())).not.toMatch(/passwordRef|credentialRef|fixture-private-password|test-session/);expect(await vaultFiles()).toHaveLength(2);
  for(const file of await vaultFiles())expect((await readFile(join(data,"credentials",file))).includes(Buffer.from("fixture-private-password"))).toBe(false);
  await stop();page=await launch();expect(logins).toBe(2);expect((await list())[0].id).toBe(id);expect(await vaultFiles()).toHaveLength(2);await page.reload();await expect.poll(list).toHaveLength(1);expect(logins).toBe(2);
  await page.getByRole("button",{name:"设置",exact:true}).click();await card().getByRole("button",{name:"编辑 / 重新登录",exact:true}).click();await expect(opt()).toBeChecked();await expect(panel().getByLabel("登录密码",{exact:true})).toHaveValue("");await opt().uncheck();await panel().getByRole("button",{name:"保存连接修改",exact:true}).click();await expect(card()).toContainText("自动登录未开启");expect(await vaultFiles()).toHaveLength(1);expect(logins).toBe(2);
  await stop();page=await launch();expect(logins).toBe(2);await page.getByRole("button",{name:"设置",exact:true}).click();await card().getByRole("button",{name:"编辑 / 重新登录",exact:true}).click();await opt().check();await panel().getByLabel("登录密码",{exact:true}).fill("fixture-private-password");await panel().getByRole("button",{name:"保存连接修改",exact:true}).click();await expect(card()).toContainText("自动登录已开启");expect(logins).toBe(3);
  await stop();fail=true;page=await launch();expect(logins).toBe(4);await expect(page.getByRole("alert").filter({hasText:"Trinity 自动登录失败"})).toBeVisible();await page.getByRole("button",{name:"前往 Trinity 设置",exact:true}).click();await expect(card()).toBeVisible();expect(logins).toBe(4);await page.screenshot({path:test.info().outputPath("trinity-auto-login-failed.png")});
  await card().getByRole("button",{name:"删除平台连接",exact:true}).click();await expect(card()).toHaveCount(0);expect(await vaultFiles()).toHaveLength(0);await expect.poll(()=>page.getByRole("alert").filter({hasText:"Trinity 自动登录失败"}).count()).toBe(0);
  fail=false;
  const converted=await page.evaluate(async base=>{
   const t=await window.platform.saveIssueConnection({kind:"trinity",platform:"trinity",name:"Converted",baseUrl:base,username:"alice",autoLogin:true,bypassProxy:true},"fixture-private-password");if(!t.ok)throw new Error(t.error.message);
   const j=await window.platform.saveIssueConnection({kind:"jira-http",platform:"jira-dc",name:"Converted Jira",baseUrl:base,username:"alice",bypassProxy:true,jiraProject:{key:"A",name:"Project A",owner:"alice",issueTypeIds:["1"]}},"fixture-jira-password",t.value.id);if(!j.ok)throw new Error(j.error.message);return j.value;
  },base);expect(converted.kind).toBe("jira-http");expect(await vaultFiles()).toHaveLength(1);
 }finally{releaseFirstLogin();await stop();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(data,{recursive:true,force:true});}
});
