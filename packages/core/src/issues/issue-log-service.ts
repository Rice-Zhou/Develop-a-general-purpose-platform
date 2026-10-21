import {WorkGate} from "../runtime/work-gate";
import {createHash,randomUUID} from "node:crypto";
import {AppError} from "../../../contracts/src/error";
import {LOG_BUDGET,type IssueLogSet,type IssueLogScope,type IssueLogSetRef,type AttachmentDescriptor,type LogFile} from "../../../contracts/src/issue-materials";
import type {IssueScope,RemoteIssue} from "../../../contracts/src/issues";
import type {IssueAdapter} from "./ports";
export const logScope=(scope:IssueScope,issue:RemoteIssue):IssueLogScope=>({platform:scope.connection.platform,instanceUrl:scope.connection.baseUrl,accountId:scope.binding.owner,remoteIssueId:issue.remoteId});
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
interface MaterialRepository {get(id:string):IssueLogSet;latest(scope:IssueLogScope):IssueLogSet|null;create(set:IssueLogSet):void;update(set:IssueLogSet):boolean}
interface Job {controller:AbortController;done:Promise<void>;finish():void;scope:IssueScope;issue:RemoteIssue}
export class IssueLogService {
 private active=0;private queue:{id:string;run:()=>Promise<void>}[]=[];
 private readonly jobs=new Map<string,Job>();private readonly controller=new AbortController();
 private readonly discoveries=new Map<string,object>();
 private readonly pending=new Map<string,Promise<IssueLogSet>>();
 constructor(private readonly repository:MaterialRepository,private readonly adapter:(scope:IssueScope)=>Pick<IssueAdapter,"listAttachments">,private readonly download:(scope:IssueScope,issue:RemoteIssue,attachments:AttachmentDescriptor[],signal:AbortSignal,progress:(files:LogFile[])=>void)=>Promise<LogFile[]>,private readonly assertCurrent:(scope:IssueScope)=>void,private readonly changed?:(set:IssueLogSet,scope:IssueScope,issue:RemoteIssue)=>void,private readonly workGate=new WorkGate()){}
 private update(set:IssueLogSet,scope:IssueScope,issue:RemoteIssue){if(this.repository.update(set))this.changed?.(set,scope,issue);}
 enqueue(scope:IssueScope,issue:RemoteIssue,force=false):Promise<IssueLogSet> {
  this.workGate.assertAccepting();
  const key=hash(logScope(scope,issue));const pending=this.discover(scope,issue,force);
  this.pending.set(key,pending);const finished=()=>{if(this.pending.get(key)===pending)this.pending.delete(key);};
  void pending.then(finished,finished);return pending;
 }
 private async discover(scope:IssueScope,issue:RemoteIssue,force=false):Promise<IssueLogSet> {
  const source=logScope(scope,issue);const key=hash(source);const request={};this.discoveries.set(key,request);
  let attachments:AttachmentDescriptor[]=[];let failure:unknown;
  try {const adapter=this.adapter(scope);if(!adapter.listAttachments)throw new AppError("ISSUE_ATTACHMENTS_UNSUPPORTED","当前 Jira CLI 不支持附件下载；请使用账号密码连接读取日志，或明确选择仅按代码分析");attachments=await adapter.listAttachments(scope,issue,AbortSignal.any([this.controller.signal,AbortSignal.timeout(60000)]));}
  catch(error){failure=error;}
  if(this.discoveries.get(key)!==request)throw new AppError("ISSUE_LOG_CHANGED","较新的日志发现请求已开始，请使用最新刷新结果");
  this.workGate.assertAccepting();this.assertCurrent(scope);
  const version=hash({issue:issue.updatedAt,attachments,adapterKind:scope.connection.kind});const previous=this.repository.latest(source);
  if(!force&&!failure&&previous?.issueVersion===version){this.discoveries.delete(key);return previous;}
  if(previous&&this.jobs.has(previous.id))await this.cancel(previous.id);
  if(this.discoveries.get(key)!==request)throw new AppError("ISSUE_LOG_CHANGED","较新的日志请求已开始，未覆盖最新下载任务");
  this.discoveries.delete(key);this.workGate.assertAccepting();this.assertCurrent(scope);
  const now=new Date().toISOString();
  const set:IssueLogSet={id:randomUUID(),scope:source,issueVersion:version,generation:(previous?.generation??0)+1,status:failure?(failure instanceof AppError&&failure.code==="ISSUE_ATTACHMENTS_UNSUPPORTED"?"UNSUPPORTED":"FAILED"):attachments.length?"QUEUED":"NO_LOGS",attachments,files:[],manifestHash:hash({attachments,files:[]}),error:failure?this.failure(failure):null,updatedAt:now};
  this.repository.create(set);this.changed?.(set,scope,issue);
  if(set.status!=="QUEUED")return set;
  let finish!:()=>void;const done=new Promise<void>(resolve=>{finish=resolve;});const controller=new AbortController();
  this.jobs.set(set.id,{controller,done,finish,scope,issue});const signal=AbortSignal.any([controller.signal,this.controller.signal]);
  this.queue.push({id:set.id,run:async()=>{
   try {
    signal.throwIfAborted();this.assertCurrent(scope);this.update({...set,status:"DOWNLOADING"},scope,issue);
    const files=await this.download(scope,issue,attachments,signal,files=>{signal.throwIfAborted();this.assertCurrent(scope);this.update({...set,status:"DOWNLOADING",files:[...files],manifestHash:hash({attachments,files}),updatedAt:new Date().toISOString()},scope,issue);});
    signal.throwIfAborted();this.assertCurrent(scope);
    this.update({...set,status:files.some(f=>f.status==="PARSED")?"READY":"UNSUPPORTED",files,manifestHash:hash({attachments,files}),error:files.some(f=>f.status==="PARSED")?null:"附件已下载，未发现可解析文本；可查看原件或选择仅按代码分析",updatedAt:new Date().toISOString()},scope,issue);
   }catch(error){this.update({...this.repository.get(set.id),status:signal.aborted?"CANCELLED":error instanceof AppError&&error.code==="ISSUE_ATTACHMENTS_UNSUPPORTED"?"UNSUPPORTED":"FAILED",error:signal.aborted?"日志下载已取消":this.failure(error),updatedAt:new Date().toISOString()},scope,issue);}
   finally{finish();this.jobs.delete(set.id);}
  }});this.pump();return this.repository.get(set.id);
 }
 async cancel(id:string):Promise<void>{
  const job=this.jobs.get(id);if(!job)return;
  job.controller.abort();const index=this.queue.findIndex(item=>item.id===id);
  if(index>=0){this.queue.splice(index,1);this.update({...this.repository.get(id),status:"CANCELLED",error:"日志下载已取消",updatedAt:new Date().toISOString()},job.scope,job.issue);job.finish();this.jobs.delete(id);}
  await job.done;
 }
 private failure(error:unknown):string {return error instanceof AppError?`${error.code}：${error.message}`:`日志处理失败：${(error as NodeJS.ErrnoException)?.code??(error instanceof Error?error.name:"UNKNOWN")}`;}
 private pump(){while(this.active<LOG_BUDGET.concurrency&&this.queue.length){this.active++;const job=this.queue.shift()!;void job.run().finally(()=>{this.active--;this.pump();});}}
 private waitFor<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{
  signal.throwIfAborted();return new Promise<T>((resolve,reject)=>{
   const abort=()=>reject(new AppError("CANCELLED","日志等待已取消"));signal.addEventListener("abort",abort,{once:true});
   promise.then(value=>{signal.removeEventListener("abort",abort);resolve(value);},error=>{signal.removeEventListener("abort",abort);reject(error);});
  });
 }
 async wait(id:string,signal:AbortSignal):Promise<IssueLogSet> {
  signal.throwIfAborted();const job=this.jobs.get(id);
  if(job)await this.waitFor(job.done,signal);
  signal.throwIfAborted();const set=this.repository.get(id);
  if(this.repository.latest(set.scope)?.id!==id)throw new AppError("ISSUE_LOG_CHANGED","日志版本已变化，请重新分析");return set;
 }
 async prepare(scope:IssueScope,issue:RemoteIssue,policy:"required"|"code-only",signal:AbortSignal):Promise<IssueLogSetRef|undefined> {
  if(policy==="code-only")return undefined;
  const discovery=this.pending.get(hash(logScope(scope,issue)));
  if(discovery)await this.waitFor(discovery,signal);
  const existing=this.repository.latest(logScope(scope,issue));
  if(!existing)throw new AppError("ISSUE_LOG_REQUIRED","问题日志尚未下载，请先刷新问题或重试独立日志下载任务");
  if(existing.issueVersion!==hash({issue:issue.updatedAt,attachments:existing.attachments,adapterKind:scope.connection.kind}))throw new AppError("ISSUE_LOG_CHANGED","问题已更新，请刷新问题以下载对应日志后重试");
  const set=await this.wait(existing.id,signal);
  if(!["READY","NO_LOGS"].includes(set.status))throw new AppError("ISSUE_LOG_REQUIRED",set.error??"日志尚未就绪，请重试下载或明确选择仅按代码分析");
  return {id:set.id,manifestHash:set.manifestHash};
 }
 async shutdown(){this.controller.abort();await Promise.allSettled([...this.pending.values(),...[...this.jobs.values()].map(job=>job.done)]); }
}
