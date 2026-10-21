import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { createHash, randomUUID } from "node:crypto";
import { AppError } from "../../../contracts/src/error";
import { LOG_BUDGET } from "../../../contracts/src/issue-materials";
import { directEnvironment } from "../network/policy";
export function attachmentUrl(value:string,base:string) {
  const url=new URL(value);
  if(url.origin!==new URL(base).origin||url.username||url.password||url.hash||!["https:","http:"].includes(url.protocol))throw new AppError("ISSUE_ATTACHMENT_URL_INVALID","附件地址越界，未发送认证信息");
  return url.href;
}
export async function downloadAttachmentFile(url:string,base:string,headers:Record<string,string>,destination:string,signal:AbortSignal,method="GET",maxBytes=LOG_BUDGET.attachment) {
  attachmentUrl(url,base);signal.throwIfAborted();
  const temporary=`${destination}.${randomUUID()}.part`;let size=0;const hash=createHash("sha256");
  const config=[`url = ${JSON.stringify(url)}`,`request = ${JSON.stringify(method)}`,...Object.entries(headers).map(([key,value])=>`header = ${JSON.stringify(`${key}: ${value}`)}`)].join("\n");
  const child=spawn(join(process.env.SystemRoot||"C:/Windows","System32","curl.exe"),["--disable","--silent","--fail","--max-time","600","--noproxy","*","--proxy","","--config","-","--write-out","%{stderr}STATUS:%{http_code}"],{windowsHide:true,shell:false,env:directEnvironment()});
  let status="";child.stderr.on("data",(part:Buffer)=>{if(status.length<4096)status+=part.toString();});
  const abort=()=>{child.kill();};signal.addEventListener("abort",abort,{once:true});
  const exit=new Promise<void>((resolve,reject)=>{child.once("error",()=>reject(new AppError("ISSUE_DOWNLOAD_FAILED","无法启动附件下载工具")));child.once("close",code=>code===0?resolve():reject(new AppError(signal.aborted?"CANCELLED":"ISSUE_DOWNLOAD_FAILED",signal.aborted?"日志下载已取消":`附件下载失败（退出码 ${code}），请检查登录和网络`)));});
  child.stdin.on("error",()=>{child.kill();});child.stdin.end(config);
  const counter=new Transform({transform(chunk:Buffer,_encoding,callback){size+=chunk.length;if(size>Math.min(maxBytes,LOG_BUDGET.attachment))callback(new AppError("MATERIAL_SIZE_LIMIT","附件实际大小超过 512 MiB"));else{hash.update(chunk);callback(null,chunk);}}});
  try {
    await Promise.all([exit,pipeline(child.stdout,counter,createWriteStream(temporary,{flags:"wx",mode:0o600}),{signal})]);
    signal.throwIfAborted();
    if(!/STATUS:200$/.test(status))throw new AppError("ISSUE_DOWNLOAD_FAILED","附件返回非 200 响应或重定向，未发布文件");
    await rename(temporary,destination);return {size,sha256:hash.digest("hex")};
  } catch(error) {
    child.kill();await exit.catch(()=>{});
    try{await unlink(temporary);}catch(cleanup){if((cleanup as NodeJS.ErrnoException).code!=="ENOENT")throw new AggregateError([error,cleanup],"下载失败且临时文件清理失败");}
    if(signal.aborted)throw new AppError("CANCELLED","日志下载已取消");throw error;
  } finally {signal.removeEventListener("abort",abort);}
}
