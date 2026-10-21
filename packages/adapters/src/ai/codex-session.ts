import {spawn} from "node:child_process";
import {createInterface} from "node:readline";
import {AppError} from "../../../contracts/src/error";
import {terminateProcessTree} from "../git/process-tree";
import {directEnvironment} from "../network/policy";
import type {CodexRequest} from "./codex-catalog";
// Metadata only: never create a conversation or execute a model turn.
export async function codexMetadataSession<T>(executable:string,options:{cwd:string;signal:AbortSignal;env?:NodeJS.ProcessEnv},read:(request:CodexRequest)=>Promise<T>):Promise<T> {
 options.signal.throwIfAborted();
 const child=spawn(executable,["app-server"],{cwd:options.cwd,env:options.env??directEnvironment(),windowsHide:true,shell:false,detached:process.platform!=="win32",stdio:["pipe","pipe","pipe"]});
 const pending=new Map<number,{resolve:(value:unknown)=>void;reject:(error:unknown)=>void}>();let id=0,bytes=0,stderr=0;let failed:AppError|undefined;let exited=false;
 const closed=new Promise<void>(resolve=>child.once("close",()=>{exited=true;resolve();}));
 const fail=(error:AppError)=>{failed??=error;for(const item of pending.values())item.reject(failed);pending.clear();};
 child.once("error",()=>fail(new AppError("CODEX_SERVICE_FAILED","无法启动 Codex 元数据服务，请检查安装路径和权限")));
 child.once("close",()=>fail(new AppError("CODEX_SERVICE_FAILED","Codex 元数据服务提前退出，请检查 CLI 版本和登录状态")));
 child.stdin.on("error",()=>fail(new AppError("CODEX_SERVICE_FAILED","无法向 Codex 发送元数据请求")));
 child.stderr.on("data",(part:Buffer)=>{stderr+=part.length;if(stderr>65536)fail(new AppError("CODEX_SERVICE_FAILED","Codex 元数据服务错误输出超过限制"));});
 child.stdout.on("data",(part:Buffer)=>{bytes+=part.length;if(bytes>1024*1024)fail(new AppError("CODEX_CATALOG_INVALID","Codex 元数据输出超过限制"));});
 const lines=createInterface({input:child.stdout});
 lines.on("line",line=>{
  if(failed)return;
  try{
   const value=JSON.parse(line) as {id?:number;error?:{code?:number};result?:unknown;method?:string};
   if(value.method&&value.id!==undefined){fail(new AppError("CODEX_INTERACTION_REQUIRED","Codex 请求额外交互，请先在工具中完成登录或配置"));return;}
   if(value.id===undefined)return;
   const item=pending.get(value.id);if(!item)return;pending.delete(value.id);
   if(value.error)item.reject(new AppError("CODEX_CATALOG_FAILED",`Codex 元数据读取失败（${value.error.code??"remote"}），请检查账号权限、代理或 CLI 版本`));else item.resolve(value.result);
  }catch{fail(new AppError("CODEX_CATALOG_INVALID","Codex 元数据响应不是有效 JSON"));}
 });
 const abort=()=>fail(new AppError("CANCELLED","Codex 检测已取消或超时"));options.signal.addEventListener("abort",abort,{once:true});
 const request:CodexRequest=(method,params)=>{
  if(failed)return Promise.reject(failed);if(options.signal.aborted)return Promise.reject(new AppError("CANCELLED","Codex 检测已取消或超时"));
  if(!["initialize","account/read","model/list"].includes(method))return Promise.reject(new AppError("CODEX_METHOD_DENIED","仅允许读取 Codex 账号和模型元数据"));
  const next=++id;return new Promise((resolve,reject)=>{pending.set(next,{resolve,reject});child.stdin.write(JSON.stringify({id:next,method,params})+"\n");});
 };
 try{
  await request("initialize",{clientInfo:{name:"local_dev_platform",title:"Local Dev Platform",version:"0.8.1"}});
  child.stdin.write(JSON.stringify({method:"initialized",params:{}})+"\n");
  return await read(request);
 }finally{
  options.signal.removeEventListener("abort",abort);lines.close();child.stdin.end();
  let timer:ReturnType<typeof setTimeout>|undefined;
  await Promise.race([closed,new Promise<void>(resolve=>{timer=setTimeout(resolve,300);})]);clearTimeout(timer);
  if(!exited&&child.pid){try{await terminateProcessTree(child.pid);}catch(error){if(!exited)throw error;}await closed;}
 }
}
