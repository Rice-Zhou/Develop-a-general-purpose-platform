import {createHash,randomUUID} from "node:crypto";
import {AppError} from "../../../contracts/src/error";
import {LOG_BUDGET,type IssueLogSet,type IssueLogScope,type IssueLogSetRef,type AttachmentDescriptor,type LogFile} from "../../../contracts/src/issue-materials";
import type {IssueScope,RemoteIssue} from "../../../contracts/src/issues";
import type {IssueAdapter} from "./ports";
export const logScope=(scope:IssueScope,issue:RemoteIssue):IssueLogScope=>({platform:scope.connection.platform,instanceUrl:scope.connection.baseUrl,accountId:scope.binding.owner,remoteIssueId:issue.remoteId});
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
interface MaterialRepository {get(id:string):IssueLogSet;latest(scope:IssueLogScope):IssueLogSet|null;create(set:IssueLogSet):void;update(set:IssueLogSet):boolean}
export class IssueLogService {
 private active=0;private queue:(()=>Promise<void>)[]=[];private readonly jobs=new Map<string,Promise<void>>();private readonly controller=new AbortController();
 constructor(private readonly repository:MaterialRepository,private readonly adapter:(scope:IssueScope)=>Pick<IssueAdapter,"listAttachments">,private readonly download:(scope:IssueScope,issue:RemoteIssue,attachments:AttachmentDescriptor[],signal:AbortSignal,progress:(files:LogFile[])=>void)=>Promise<LogFile[]>,private readonly assertCurrent:(scope:IssueScope)=>void){}
 async enqueue(scope:IssueScope,issue:RemoteIssue,force=false):Promise<IssueLogSet> {
  const source=logScope(scope,issue);let attachments:AttachmentDescriptor[]=[];let failure:unknown;
  try {const adapter=this.adapter(scope);if(!adapter.listAttachments)throw new AppError("ISSUE_ATTACHMENTS_UNSUPPORTED","当前 Jira CLI 不支持附件下载；请使用账号密码连接读取日志，或明确选择仅按代码分析");attachments=await adapter.listAttachments(scope,issue,this.controller.signal);this.assertCurrent(scope);}
  catch(error){failure=error;}
  const version=hash({issue:issue.updatedAt,attachments,adapterKind:scope.connection.kind});const previous=this.repository.latest(source);
  if(!force&&!failure&&previous?.issueVersion===version)return previous;
  const now=new Date().toISOString();
  const set:IssueLogSet={id:randomUUID(),scope:source,issueVersion:version,generation:(previous?.generation??0)+1,status:failure?(failure instanceof AppError&&failure.code==="ISSUE_ATTACHMENTS_UNSUPPORTED"?"UNSUPPORTED":"FAILED"):attachments.length?"QUEUED":"NO_LOGS",attachments,files:[],manifestHash:hash({attachments,files:[]}),error:failure?this.failure(failure):null,updatedAt:now};
  this.repository.create(set);
  if(set.status!=="QUEUED")return set;
  let finish!:()=>void;this.jobs.set(set.id,new Promise<void>(resolve=>{finish=resolve;}));
  this.queue.push(async()=>{
   try {
    this.assertCurrent(scope);if(!this.repository.update({...set,status:"DOWNLOADING"}))return;
    const files=await this.download(scope,issue,attachments,this.controller.signal,files=>{this.assertCurrent(scope);this.repository.update({...set,status:"DOWNLOADING",files:[...files],manifestHash:hash({attachments,files}),updatedAt:new Date().toISOString()});});this.assertCurrent(scope);
    this.repository.update({...set,status:files.some(f=>f.status==="PARSED")?"READY":"UNSUPPORTED",files,manifestHash:hash({attachments,files}),error:files.some(f=>f.status==="PARSED")?null:"附件已下载，未发现可解析文本；可查看原件或选择仅按代码分析",updatedAt:new Date().toISOString()});
   }catch(error){this.repository.update({...this.repository.get(set.id),status:error instanceof AppError&&error.code==="ISSUE_ATTACHMENTS_UNSUPPORTED"?"UNSUPPORTED":"FAILED",error:this.failure(error),updatedAt:new Date().toISOString()});}
   finally{finish();this.jobs.delete(set.id);}
  });this.pump();return this.repository.get(set.id);
 }
 private failure(error:unknown):string {return error instanceof AppError?`${error.code}：${error.message}`:`日志处理失败：${(error as NodeJS.ErrnoException)?.code??(error instanceof Error?error.name:"UNKNOWN")}`;}
 private pump(){while(this.active<LOG_BUDGET.concurrency&&this.queue.length){this.active++;const job=this.queue.shift()!;void job().finally(()=>{this.active--;this.pump();});}}
 async wait(id:string,signal:AbortSignal):Promise<IssueLogSet> {
  signal.throwIfAborted();const job=this.jobs.get(id);
  if(job)await new Promise<void>((resolve,reject)=>{const abort=()=>reject(new AppError("CANCELLED","日志等待已取消"));signal.addEventListener("abort",abort,{once:true});job.then(()=>{signal.removeEventListener("abort",abort);resolve();},reject);});
  signal.throwIfAborted();const set=this.repository.get(id);
  if(this.repository.latest(set.scope)?.id!==id)throw new AppError("ISSUE_LOG_CHANGED","日志版本已变化，请重新分析");return set;
 }
 async prepare(scope:IssueScope,issue:RemoteIssue,policy:"required"|"code-only",signal:AbortSignal):Promise<IssueLogSetRef|undefined> {
  if(policy==="code-only")return undefined;
  const set=await this.wait((await this.enqueue(scope,issue)).id,signal);
  if(!["READY","NO_LOGS"].includes(set.status))throw new AppError("ISSUE_LOG_REQUIRED",set.error??"日志尚未就绪，请重试下载或明确选择仅按代码分析");
  return {id:set.id,manifestHash:set.manifestHash};
 }
 async shutdown(){this.controller.abort();await Promise.all(this.jobs.values());}
}
