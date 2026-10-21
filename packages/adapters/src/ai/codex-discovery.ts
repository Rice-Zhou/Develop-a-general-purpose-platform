import {readdir,realpath,stat} from "node:fs/promises";
import {join,delimiter} from "node:path";
import {AppError} from "../../../contracts/src/error";
import type {CodexCandidate} from "../../../contracts/src/codex";
import {runProcess} from "../process/run-process";
export interface CodexLocations {appData:string;localAppData:string;path:string;cwd:string;signal:AbortSignal;existing?:string[]}
const numeric=(a:number,b:number)=>a===b?0:a>b?1:-1;
export function compareCodexVersions(a:string,b:string):number {
 const parts=(v:string)=>v.split("+")[0].split(/-(.*)/s);
 const [av,ap]=parts(a),[bv,bp]=parts(b);const aa=av.split(".").map(Number),bb=bv.split(".").map(Number);
 for(let i=0;i<3;i++){const d=numeric(aa[i],bb[i]);if(d)return d;}
 if(ap===bp)return 0;if(ap===undefined)return 1;if(bp===undefined)return -1;
 const x=ap.split("."),y=bp.split(".");
 for(let i=0;i<Math.max(x.length,y.length);i++){
  if(x[i]===undefined)return -1;if(y[i]===undefined)return 1;if(x[i]===y[i])continue;
  const xn=/^\d+$/.test(x[i]),yn=/^\d+$/.test(y[i]);
  if(xn&&yn)return numeric(Number(x[i]),Number(y[i]));if(xn!==yn)return xn?-1:1;return x[i]>y[i]?1:-1;
 }return 0;
}
async function directories(path:string) {
 try{return (await readdir(path,{withFileTypes:true})).filter(d=>d.isDirectory()).map(d=>d.name);}
 catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return [];throw new AppError("CODEX_DISCOVERY_FAILED","无法读取 Codex 安装目录，请检查目录权限");}
}
export async function discoverCodexCli(locations:CodexLocations,run:typeof runProcess=runProcess) {
 const paths=new Set<string>(locations.existing??[]);
 const npmRoots=new Set([join(locations.appData,"npm"),...locations.path.split(delimiter).filter(Boolean)]);
 for(const root of npmRoots){
  paths.add(join(root,"codex.exe"));
  for(const arch of ["x64","arm64"])paths.add(join(root,`node_modules/@openai/codex/node_modules/@openai/codex-win32-${arch}/vendor/${arch==="x64"?"x86_64":"aarch64"}-pc-windows-msvc/bin/codex.exe`));
 }
 const desktop=join(locations.localAppData,"OpenAI/Codex/bin");
 paths.add(join(desktop,"codex.exe"));
 const dirs=await directories(desktop);if(dirs.length>64)throw new AppError("CODEX_DISCOVERY_LIMIT","Codex 安装目录过多，请清理不再使用的 CLI 版本后重新检测");
 for(const dir of dirs)paths.add(join(desktop,dir,"codex.exe"));
 const canonical=new Map<string,string>();
 for(const path of paths){
  locations.signal.throwIfAborted();
  try{if(!(await stat(path)).isFile())continue;const actual=await realpath(path);if(!/codex\.exe$/i.test(actual))continue;canonical.set(actual.toLowerCase(),actual);}
  catch(error){if(["ENOENT","ENOTDIR"].includes((error as NodeJS.ErrnoException).code??""))continue;throw new AppError("CODEX_DISCOVERY_FAILED","无法检查 Codex 可执行文件，请检查路径权限");}
 }
 if(canonical.size>64)throw new AppError("CODEX_DISCOVERY_LIMIT","检测到过多 Codex CLI，未选择版本");
 const candidates:CodexCandidate[]=[];const pending=[...canonical.values()];
 await Promise.all(Array.from({length:Math.min(4,pending.length)},async()=>{
  while(pending.length){const executable=pending.shift()!;locations.signal.throwIfAborted();
   try{
    const output=await run(executable,["--version"],{cwd:locations.cwd,signal:locations.signal,timeoutMs:3000,maxOutput:4096});
    const version=/^codex-cli\s+(\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?)\s*$/.exec(output.trim())?.[1];
    if(!version)throw new AppError("CODEX_VERSION_INVALID","无法识别 CLI 版本号");candidates.push({executable,version,error:null});
   }catch(error){locations.signal.throwIfAborted();candidates.push({executable,version:null,error:error instanceof AppError?error.code:"CODEX_PROBE_FAILED"});}
  }
 }));
 candidates.sort((a,b)=>a.version&&b.version?compareCodexVersions(b.version,a.version)||a.executable.localeCompare(b.executable):a.version?-1:b.version?1:a.executable.localeCompare(b.executable));
 const unverified=candidates.filter(c=>c.error);
 if(unverified.length)throw new AppError("CODEX_VERSION_UNVERIFIED",`存在无法确认版本的 Codex CLI，未自动改用其他版本。请检查安装后重新检测：${unverified.map(c=>`${c.executable}（${c.error}）`).join("；")}`);
 const selected=candidates.find((c):c is CodexCandidate&{version:string}=>c.version!==null);
 if(!selected)throw new AppError("CODEX_NOT_FOUND",candidates.length?"检测到 Codex 文件，但均无法读取有效版本；请检查安装或执行权限":"未发现本地 Codex CLI，请先安装 Codex 桌面端或 CLI 并完成登录");
 return {selected:{executable:selected.executable,version:selected.version},candidates};
}
