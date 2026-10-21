import {open} from "node:fs/promises";
import {createReadStream} from "node:fs";
import {createHash} from "node:crypto";
import type {LogFile} from "../../../contracts/src/issue-materials";
import {LOG_BUDGET} from "../../../contracts/src/issue-materials";
import type {SnapshotStore} from "../../../storage/src/snapshot-store";
export async function parseTextLog(path:string,name:string,attachmentId:string,originalHash:string,size:number,content:SnapshotStore,signal:AbortSignal):Promise<LogFile> {
 const base={id:createHash("sha256").update(`${attachmentId}:${name}:${originalHash}`).digest("hex"),attachmentId,path:name,originalHash,size};
 const handle=await open(path,"r");const prefix=Buffer.alloc(4096);let length=0;try{length=(await handle.read(prefix,0,prefix.length,0)).bytesRead;}finally{await handle.close();}
 const sample=prefix.subarray(0,length);
 const encoding=sample[0]===255&&sample[1]===254?"utf-16le":sample[0]===254&&sample[1]===255?"utf-16be":"utf-8";
 if((encoding==="utf-8"&&sample.includes(0))||/\.(?:png|jpg|jpeg|mp4|rar|7z|gz|pdf|docx|exe|dll|bin)$/i.test(name))return {...base,status:"UNSUPPORTED",contentHash:null,encoding:null,lineCount:0,error:"二进制或压缩格式暂不支持文本解析，原件已保留"};
 let lineCount=1;let bytesRead=0;
 async function* decoded(){
  const decoder=new TextDecoder(encoding,{fatal:true});
  for await(const part of createReadStream(path)){signal.throwIfAborted();bytesRead+=(part as Buffer).length;const value=decoder.decode(part as Buffer,{stream:true});lineCount+=(value.match(/\n/g)??[]).length;yield Buffer.from(value);}
  const tail=decoder.decode();lineCount+=(tail.match(/\n/g)??[]).length;yield Buffer.from(tail);
 }
 try {
  const parsed=await content.putStream(decoded(),LOG_BUDGET.uncompressed,signal);
  return {...base,status:"PARSED",contentHash:parsed.hash,encoding,lineCount:bytesRead?lineCount:0,error:null};
 }catch(error){if(error instanceof TypeError&&(error as NodeJS.ErrnoException).code==="ERR_ENCODING_INVALID_ENCODED_DATA")return {...base,status:"UNSUPPORTED",contentHash:null,encoding:null,lineCount:0,error:"日志编码无法可靠解析，原件已保留"};throw error;}
}
