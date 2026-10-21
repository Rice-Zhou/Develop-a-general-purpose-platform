import * as yauzl from "yauzl";
import {crc32} from "node:zlib";
import {LOG_BUDGET,type AttachmentDescriptor,type LogFile} from "../../../contracts/src/issue-materials";
import {AppError} from "../../../contracts/src/error";
import {readablePath} from "../../../core/src/context/access-policy";
import type {SnapshotStore} from "../../../storage/src/snapshot-store";
import {parseTextLog} from "./text-log-reader";
export async function parseLogAttachment(path:string,attachment:AttachmentDescriptor,originalHash:string,content:SnapshotStore,signal:AbortSignal,budget={bytes:0,files:0}):Promise<LogFile[]> {
 async function parse(filePath:string,name:string,hash:string,size:number,depth:number):Promise<LogFile[]> {
  signal.throwIfAborted();
  if(!name.toLowerCase().endsWith(".zip"))return [await parseTextLog(filePath,name,attachment.id,hash,size,content,signal)];
  if(depth>=LOG_BUDGET.nesting)throw new AppError("LOG_ZIP_DEPTH","ZIP 嵌套超过 2 层，未发布不完整日志");
  const zip=await new Promise<yauzl.ZipFile>((resolve,reject)=>yauzl.open(filePath,{lazyEntries:true,validateEntrySizes:true,strictFileNames:true,autoClose:false},(error,value)=>error?reject(error):resolve(value)));
  const results:LogFile[]=[]; const seen=new Set<string>();
  const abort=()=>zip.close();signal.addEventListener("abort",abort,{once:true});
  try {
   await new Promise<void>((resolve,reject)=>{
    const onAbort=()=>reject(new AppError("CANCELLED","日志解包已取消"));signal.addEventListener("abort",onAbort,{once:true});
    const finish=(error?:unknown)=>{signal.removeEventListener("abort",onAbort);if(error)reject(error);else resolve();};
    zip.once("error",finish);zip.once("end",()=>finish());
    zip.on("entry",(entry:yauzl.Entry)=>{void (async()=>{
     signal.throwIfAborted(); const mode=(entry.externalFileAttributes>>>16)&0xf000;
     const normalized=entry.fileName.replace(/\/$/,"");
     if(!readablePath(normalized)||mode===0xa000||(entry.generalPurposeBitFlag&1))throw new AppError("LOG_ZIP_UNSAFE","ZIP 含越界路径、敏感文件、链接或加密条目");
     const key=normalized.toLowerCase();if(seen.has(key))throw new AppError("LOG_ZIP_DUPLICATE","ZIP 含重复路径");seen.add(key);
     if(++budget.files>LOG_BUDGET.files)throw new AppError("LOG_ZIP_LIMIT","ZIP 文件数超过 10000");
     if(!entry.fileName.endsWith("/")) {
      if(entry.uncompressedSize>LOG_BUDGET.uncompressed-budget.bytes)throw new AppError("LOG_ZIP_LIMIT","ZIP 声明解压大小超过剩余预算");
      const stream=await new Promise<import("node:stream").Readable>((resolve,reject)=>zip.openReadStream(entry,(error,value)=>error?reject(error):resolve(value)));
      let checksum=0;
      async function* counted(){for await(const part of stream){const bytes=part as Buffer;checksum=crc32(bytes,checksum);budget.bytes+=bytes.length;if(budget.bytes>LOG_BUDGET.uncompressed)throw new AppError("LOG_ZIP_LIMIT","ZIP 实际解压大小超过 2 GiB");yield bytes;}}
      const stored=await content.putStream(counted(),LOG_BUDGET.uncompressed,signal);
      if(stored.size!==entry.uncompressedSize||checksum!==entry.crc32)throw new AppError("LOG_ZIP_INVALID","ZIP 大小或 CRC 校验不符");
      results.push(...await parse(await content.verifiedPath(stored.hash),`${name}/${entry.fileName}`,stored.hash,stored.size,depth+1));
     }
     zip.readEntry();
    })().catch(finish);});zip.readEntry();
   });return results;
  } finally {signal.removeEventListener("abort",abort);zip.close();}
 }
 return parse(path,attachment.name,originalHash,attachment.size??0,0);
}
