import {test,expect,_electron as electron} from "@playwright/test";
import {mkdtemp,mkdir,writeFile,copyFile,readFile,rm} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import {join,resolve,dirname,delimiter} from "node:path";
import {tmpdir} from "node:os";
test("auto-selects latest Codex and live account models, preserves edited connection, rejects stale selections without fallback",async()=>{
 test.setTimeout(120000);const root=await mkdtemp(join(tmpdir(),"codex-discovery-e2e-"));let app:Awaited<ReturnType<typeof electron.launch>>|undefined;
 const roaming=join(root,"roaming"),local=join(root,"local");const old=join(roaming,"npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe"),latest=join(local,"OpenAI/Codex/bin/new/codex.exe");
 try{
  for(const p of [old,latest])await mkdir(dirname(p),{recursive:true});
  execFileSync(join(process.env.SystemRoot??"C:/Windows","Microsoft.NET/Framework64/v4.0.30319/csc.exe"),["/nologo","/r:System.Web.Extensions.dll",`/out:${old}`,resolve("packages/testkit/fixtures/CodexCatalogueFixture.cs")],{windowsHide:true,stdio:"pipe"});await copyFile(old,latest);await writeFile(join(dirname(old),"version.txt"),"0.149.1");
  const inheritedPath=(process.env.PATH??"").split(delimiter).filter(p=>!/(?:npm|OpenAI[\\/]Codex)/i.test(p));
  app=await electron.launch({executablePath:process.env.PLATFORM_EXECUTABLE!,args:[],env:{...process.env,PLATFORM_DATA_DIR:join(root,"data"),PLATFORM_E2E:"1",HOME:root,USERPROFILE:root,APPDATA:roaming,LOCALAPPDATA:local,PATH:[dirname(old),...inheritedPath].join(delimiter)}});const page=await app.firstWindow();
  await page.getByRole("button",{name:"设置",exact:true}).click();await page.getByRole("button",{name:"新增 AI 连接",exact:true}).click();
  await page.getByRole("combobox",{name:/^执行方式/}).selectOption("codex");
  await expect(page.getByLabel("已自动选择的 Codex CLI",{exact:true})).toHaveValue(latest);
  await expect(page.getByText("0.163.0-alpha.10.2",{exact:false}).first()).toBeVisible();
  const model=page.getByRole("combobox",{name:"Codex 模型",exact:true});await expect(model).toHaveValue("gpt-6.1-sol");await expect(model.locator("option")).toContainText(["GPT-6.1 Sol","GPT-6 Luna"]);
  await page.getByLabel("连接名称",{exact:true}).last().fill("自动 Codex");await page.getByRole("button",{name:"保存模型连接",exact:true}).click();
  const profiles=()=>page.evaluate(async()=>{const r=await window.platform.getAIProfiles();if(!r.ok)throw new Error(r.error.message);return r.value;});await expect.poll(profiles).toHaveLength(1);const id=(await profiles())[0].id;
  await page.getByRole("button",{name:"编辑连接",exact:true}).click();await expect(model).toBeEnabled();await model.selectOption("gpt-6-luna");await page.getByRole("button",{name:"保存连接修改",exact:true}).click();await expect.poll(async()=>(await profiles())[0].model).toBe("gpt-6-luna");expect((await profiles())[0].id).toBe(id);
  expect(await page.evaluate(async()=>{const r=await window.platform.getDefaultAIProfile();return r.ok?r.value:null;})).toBe(id);
  await page.getByRole("button",{name:"编辑连接",exact:true}).click();await expect(model).toBeEnabled();await writeFile(join(dirname(latest),"catalog-failed"),"");await page.getByRole("button",{name:"重新检测 Codex CLI 与模型",exact:true}).click();await expect(page.getByRole("alert").first()).toContainText("CODEX_CATALOG_FAILED");await expect(model).toBeDisabled();await expect(page.getByRole("button",{name:"保存连接修改",exact:true})).toBeDisabled();expect(await readFile(join(dirname(old),"calls.log"),"utf8")).not.toContain("app-server");
  await rm(join(dirname(latest),"catalog-failed"));await page.getByRole("button",{name:"重新检测 Codex CLI 与模型",exact:true}).click();await expect(model).toBeEnabled();
  await writeFile(join(dirname(latest),"custom-catalog"),"");await page.getByRole("button",{name:"重新检测 Codex CLI 与模型",exact:true}).click();await expect(page.getByRole("alert").first()).toContainText("CODEX_CONFIG_INCOMPATIBLE");await expect(model).toBeDisabled();await rm(join(dirname(latest),"custom-catalog"));
  await writeFile(join(dirname(latest),"version.txt"),"invalid");await page.getByRole("button",{name:"重新检测 Codex CLI 与模型",exact:true}).click();await expect(page.getByRole("alert").first()).toContainText("CODEX_VERSION_UNVERIFIED");await expect(model).toBeDisabled();await writeFile(join(dirname(latest),"version.txt"),"0.163.0-alpha.10.2");await page.getByRole("button",{name:"重新检测 Codex CLI 与模型",exact:true}).click();await expect(model).toBeEnabled();
  const rejected=await page.evaluate(async({id,latest})=>window.platform.saveAIProfile({kind:"codex",name:"自动 Codex",executable:latest,model:"not-available",outboundEnabled:false},undefined,id),{id,latest});expect(rejected.ok).toBe(false);if(!rejected.ok)expect(rejected.error.code).toBe("CODEX_MODEL_UNAVAILABLE");expect((await profiles())[0].model).toBe("gpt-6-luna");
  await page.screenshot({path:test.info().outputPath("codex-auto-discovery.png")});
 }finally{await app?.close();await rm(root,{recursive:true,force:true});}
});
