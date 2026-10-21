import {expect,it} from "vitest";
import {execFileSync} from "node:child_process";
import {mkdtemp,readFile,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {codexMetadataSession} from "./codex-session";
import {readCodexCatalogue} from "./codex-catalog";
it("reads actual stdio metadata, rejects remote failures and terminates a cancelled child",async()=>{
 const root=await mkdtemp(join(tmpdir(),"codex-session-"));const exe=join(root,"codex.exe");
 try{
  execFileSync(join(process.env.SystemRoot??"C:/Windows","Microsoft.NET/Framework64/v4.0.30319/csc.exe"),["/nologo","/r:System.Web.Extensions.dll",`/out:${exe}`,resolve("packages/testkit/fixtures/CodexCatalogueFixture.cs")],{windowsHide:true,stdio:"pipe"});
  const run=(signal:AbortSignal)=>codexMetadataSession(exe,{cwd:root,signal},readCodexCatalogue);
  expect((await run(AbortSignal.timeout(10000))).models.map(m=>m.id)).toEqual(["gpt-6.1-sol","gpt-6-luna"]);
  await writeFile(join(root,"catalog-failed"),"");await expect(run(AbortSignal.timeout(10000))).rejects.toMatchObject({code:"CODEX_CATALOG_FAILED"});await rm(join(root,"catalog-failed"));
  await writeFile(join(root,"hang"),"");await expect(run(AbortSignal.timeout(500))).rejects.toMatchObject({code:"CANCELLED"});
  const pid=Number(await readFile(join(root,"running.pid"),"utf8"));expect(()=>process.kill(pid,0)).toThrow();
  const calls=await readFile(join(root,"calls.log"),"utf8");expect(calls).not.toContain("turn/start");expect(calls).not.toContain("thread/start");
 }finally{await rm(root,{recursive:true,force:true});}
});
