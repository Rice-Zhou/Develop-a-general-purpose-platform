import {expect,it,vi} from "vitest";
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {discoverCodexCli,compareCodexVersions} from "./codex-discovery";
it("orders numeric and prerelease versions instead of PATH order",()=>{
 expect(compareCodexVersions("0.163.0-alpha.10.2","0.149.1")).toBeGreaterThan(0);
 expect(compareCodexVersions("0.163.0","0.163.0-alpha.10.2")).toBeGreaterThan(0);
 expect(compareCodexVersions("0.163.0-alpha.10","0.163.0-alpha.2")).toBeGreaterThan(0);
 expect(compareCodexVersions("0.10.0","0.9.0")).toBeGreaterThan(0);
});
it("discovers desktop and npm actual executables and picks latest without using shell wrappers",async()=>{
 const root=await mkdtemp(join(tmpdir(),"codex-discovery-"));
 try{
  const npm=join(root,"npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe");const desktop=join(root,"local/OpenAI/Codex/bin/release/codex.exe");
  for(const file of [npm,desktop]){await mkdir(join(file,".."),{recursive:true});await writeFile(file,"");}
  const run=vi.fn(async(exe:string)=>`codex-cli ${exe===desktop?"0.163.0-alpha.10.2":"0.149.1"}\n`);
  const result=await discoverCodexCli({appData:root,localAppData:join(root,"local"),path:join(root,"npm"),cwd:root,signal:new AbortController().signal},run);
  expect(result.selected.executable).toBe(desktop);expect(result.selected.version).toBe("0.163.0-alpha.10.2");expect(result.candidates).toHaveLength(2);expect(run).toHaveBeenCalledTimes(2);
 }finally{await rm(root,{recursive:true,force:true});}
});
it("reports missing installations explicitly",async()=>{
 const root=await mkdtemp(join(tmpdir(),"codex-empty-"));try{await expect(discoverCodexCli({appData:root,localAppData:root,path:"",cwd:root,signal:new AbortController().signal})).rejects.toMatchObject({code:"CODEX_NOT_FOUND"});}finally{await rm(root,{recursive:true,force:true});}
});
