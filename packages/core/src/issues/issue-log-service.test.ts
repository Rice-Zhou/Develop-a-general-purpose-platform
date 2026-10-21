import {expect,it,vi} from "vitest";
import {IssueLogService} from "./issue-log-service";
import {AppError} from "../../../contracts/src/error";
import type {IssueLogSet,IssueLogScope} from "../../../contracts/src/issue-materials";
import type {IssueScope,RemoteIssue} from "../../../contracts/src/issues";
for(const rotated of [false,true])it(`discards obsolete attachment discovery before publishing (credential rotation: ${rotated})`,async()=>{
 const sets:IssueLogSet[]=[];const repository={get:(id:string)=>sets.find(s=>s.id===id)!,latest:()=>sets.at(-1)??null,create:(set:IssueLogSet)=>{sets.push(set);},update:()=>true};
 let release!:()=>void;const gate=new Promise<void>(r=>release=r);let calls=0;
 const original={connection:{kind:"trinity",platform:"trinity",baseUrl:"https://t",credentialRef:"old"},binding:{owner:"a"}} as IssueScope;
 const current={...original,connection:{...original.connection,credentialRef:rotated?"new":"old"}};
 const service=new IssueLogService(repository,()=>({listAttachments:async()=>{if(++calls===1)await gate;return [];}}),vi.fn(),scope=>{if(scope.connection.credentialRef!==current.connection.credentialRef)throw new AppError("PROJECT_CHANGED","credentials changed");});
 const issue={remoteId:"b",updatedAt:"1"} as RemoteIssue;
 const old=service.enqueue(original,issue);const outcome=old.then(()=>"published",error=>(error as AppError).code);
 const fresh=await service.enqueue(current,{...issue,updatedAt:"2"});release();
 expect(await outcome).toMatch(/ISSUE_LOG_CHANGED|PROJECT_CHANGED/);expect(repository.latest()?.id).toBe(fresh.id);expect(sets).toHaveLength(1);expect(fresh.status).toBe("NO_LOGS");
});
it("deduplicates shared issue generations and never publishes an older completed download",async()=>{
 const sets:IssueLogSet[]=[];let release!:()=>void;const gate=new Promise<void>(r=>release=r);
 const repository={get:(id:string)=>sets.find(s=>s.id===id)!,latest:(_scope:IssueLogScope)=>sets.at(-1)??null,create:(set:IssueLogSet)=>{sets.push(set);},update:(set:IssueLogSet)=>{if(sets.at(-1)?.id!==set.id)return false;sets[sets.length-1]=set;return true;}};
 const download=vi.fn(async(_scope,_issue,_attachments,signal:AbortSignal)=>{await Promise.race([gate,new Promise<void>(resolve=>signal.addEventListener("abort",()=>resolve(),{once:true}))]);return [{id:"f",attachmentId:"a",path:"log.txt",originalHash:"h",contentHash:"h",size:1,encoding:"utf-8",lineCount:1,status:"PARSED" as const,error:null}];});
 const adapter={listAttachments:async()=>[{id:"a",name:"log.txt",size:1,mediaType:"text/plain",version:"v"}]};
 const service=new IssueLogService(repository,()=>adapter,download,()=>{});
 const scope={connection:{platform:"trinity",baseUrl:"https://t",id:"c"},binding:{owner:"a"}} as IssueScope;
 const issue={remoteId:"b",key:"BUG",updatedAt:"1"} as RemoteIssue;
 const first=await service.enqueue(scope,issue);const same=await service.enqueue({...scope,projectId:"another"},issue);expect(same.id).toBe(first.id);
 const second=await service.enqueue(scope,{...issue,updatedAt:"2"});expect(second.generation).toBe(2);
 release();await service.wait(second.id,new AbortController().signal);
 expect(repository.latest(first.scope)?.id).toBe(second.id);expect(repository.latest(first.scope)?.status).toBe("READY");expect(download).toHaveBeenCalledTimes(2);
});
it("does not repeatedly download unchanged unsupported attachments on periodic refresh",async()=>{
 const sets:IssueLogSet[]=[];const repository={get:(id:string)=>sets.find(set=>set.id===id)!,latest:()=>sets.at(-1)??null,create:(set:IssueLogSet)=>{sets.push(set);},update:(set:IssueLogSet)=>{sets[sets.findIndex(row=>row.id===set.id)]=set;return true;}};
 const download=vi.fn(async()=>[{id:"f",attachmentId:"a",path:"video.mp4",originalHash:"h",contentHash:null,size:1,encoding:null,lineCount:0,status:"UNSUPPORTED" as const,error:"unsupported"}]);
 const service=new IssueLogService(repository,()=>({listAttachments:async()=>[{id:"a",name:"video.mp4",mediaType:"video/mp4",size:1,version:"same"}]}),download,()=>{});
 const scope={connection:{kind:"trinity",platform:"trinity",baseUrl:"https://t"},binding:{owner:"a"}} as IssueScope;const issue={remoteId:"b",updatedAt:"1"} as RemoteIssue;
 const first=await service.enqueue(scope,issue);await service.wait(first.id,new AbortController().signal);
 const next=await service.enqueue(scope,issue);expect(next.id).toBe(first.id);expect(download).toHaveBeenCalledOnce();
});
it("preanalysis only consumes previously indexed logs and never starts downloads",async()=>{
 const repository={get:vi.fn(),latest:()=>null,create:vi.fn(),update:vi.fn()};const adapter=vi.fn(()=>({listAttachments:vi.fn(async()=>[])}));const download=vi.fn();const service=new IssueLogService(repository,adapter,download,()=>{});const scope={connection:{kind:"trinity",platform:"trinity",baseUrl:"https://t"},binding:{owner:"a"}} as IssueScope;
 await expect(service.prepare(scope,{remoteId:"b",updatedAt:"1"} as RemoteIssue,"required",new AbortController().signal)).rejects.toMatchObject({code:"ISSUE_LOG_REQUIRED"});expect(adapter).not.toHaveBeenCalled();expect(download).not.toHaveBeenCalled();
});
it("cancels an individual queued log job without cancelling another download",async()=>{
 const sets:IssueLogSet[]=[];const repository={get:(id:string)=>sets.find(s=>s.id===id)!,latest:(scope:IssueLogScope)=>sets.filter(s=>s.scope.remoteIssueId===scope.remoteIssueId).at(-1)??null,create:(s:IssueLogSet)=>{sets.push(s);},update:(s:IssueLogSet)=>{sets[sets.findIndex(x=>x.id===s.id)]=s;return true;}};
 let release!:()=>void;const gate=new Promise<void>(r=>release=r);const download=vi.fn(async()=>{await gate;return [];});const changed=vi.fn();const service=new IssueLogService(repository,()=>({listAttachments:async()=>[{id:"a",name:"log",mediaType:"text/plain",size:1,version:"1"}]}),download,()=>{},changed);
 const scope={projectId:"p",connection:{kind:"trinity",platform:"trinity",baseUrl:"https://t"},binding:{owner:"a"}} as IssueScope;const first=await service.enqueue(scope,{remoteId:"1",updatedAt:"1"} as RemoteIssue);const second=await service.enqueue(scope,{remoteId:"2",updatedAt:"1"} as RemoteIssue);await service.cancel(second.id);expect(repository.get(second.id).status).toBe("CANCELLED");release();await service.wait(first.id,new AbortController().signal);expect(download).toHaveBeenCalledTimes(1);expect(changed).toHaveBeenCalled();
});
it("only the latest concurrent replacement may publish after waiting for the same cancelled generation",async()=>{
 const sets:IssueLogSet[]=[];const repository={get:(id:string)=>sets.find(s=>s.id===id)!,latest:()=>sets.at(-1)??null,create:(s:IssueLogSet)=>{if(sets.some(x=>x.generation===s.generation))throw new Error("UNIQUE generation");sets.push(s);},update:(s:IssueLogSet)=>{if(sets.at(-1)?.id!==s.id)return false;sets[sets.length-1]=s;return true;}};
 let release!:()=>void;const gate=new Promise<void>(r=>release=r);let count=0;const service=new IssueLogService(repository,()=>({listAttachments:async()=>[{id:"a",name:"a",mediaType:"text/plain",size:1,version:"a"}]}),async()=>{if(++count===1)await gate;return [];},()=>{});
 const scope={connection:{kind:"trinity",platform:"trinity",baseUrl:"https://t"},binding:{owner:"a"}} as IssueScope;const issue={remoteId:"b",updatedAt:"1"} as RemoteIssue;await service.enqueue(scope,issue);
 const first=service.enqueue(scope,{...issue,updatedAt:"2"}).then(()=>"published",e=>(e as AppError).code);await new Promise(r=>setImmediate(r));const second=service.enqueue(scope,{...issue,updatedAt:"3"});await new Promise(r=>setImmediate(r));release();expect(await first).toBe("ISSUE_LOG_CHANGED");const latest=await second;await service.wait(latest.id,new AbortController().signal);expect(sets).toHaveLength(2);expect(latest.generation).toBe(2);
});
it("waits for an indexed in-flight attachment discovery without starting a second download",async()=>{
 const sets:IssueLogSet[]=[];const repository={get:(id:string)=>sets.find(s=>s.id===id)!,latest:()=>sets.at(-1)??null,create:(s:IssueLogSet)=>{sets.push(s);},update:()=>true};let release!:()=>void;const gate=new Promise<void>(r=>release=r);const adapter=vi.fn(()=>({listAttachments:async()=>{await gate;return [];}}));const service=new IssueLogService(repository,adapter,vi.fn(),()=>{});const scope={connection:{kind:"trinity",platform:"trinity",baseUrl:"https://t"},binding:{owner:"a"}} as IssueScope;const issue={remoteId:"b",updatedAt:"1"} as RemoteIssue;
 const indexed=service.enqueue(scope,issue);let state="waiting";const prepared=service.prepare(scope,issue,"required",new AbortController().signal).then(v=>{state="ready";return v;},error=>{state="failed";throw error;});const settled=prepared.catch(()=>undefined);
 await new Promise(r=>setImmediate(r));release();await indexed;await settled;expect(state).toBe("ready");expect(adapter).toHaveBeenCalledTimes(1);
});
it("cancelling analysis while discovery is pending does not cancel shared log indexing",async()=>{
 const sets:IssueLogSet[]=[];const repository={get:(id:string)=>sets.find(s=>s.id===id)!,latest:()=>sets.at(-1)??null,create:(s:IssueLogSet)=>{sets.push(s);},update:()=>true};let release!:()=>void;let sharedSignal:AbortSignal|undefined;const gate=new Promise<void>(r=>release=r);const service=new IssueLogService(repository,()=>({listAttachments:async(_scope,_issue,signal)=>{sharedSignal=signal;await gate;return [];}}),vi.fn(),()=>{});const scope={connection:{kind:"trinity",platform:"trinity",baseUrl:"https://t"},binding:{owner:"a"}} as IssueScope;const issue={remoteId:"b",updatedAt:"1"} as RemoteIssue;const indexed=service.enqueue(scope,issue);const controller=new AbortController();const analysis=service.prepare(scope,issue,"required",controller.signal);controller.abort();await expect(analysis).rejects.toMatchObject({code:"CANCELLED"});expect(sharedSignal?.aborted).toBe(false);release();expect((await indexed).status).toBe("NO_LOGS");
});
it("shutdown aborts and waits for in-flight attachment discovery instead of leaving a network request behind",async()=>{
 const sets:IssueLogSet[]=[];const repository={get:(id:string)=>sets.find(s=>s.id===id)!,latest:()=>sets.at(-1)??null,create:(s:IssueLogSet)=>{sets.push(s);},update:()=>true};const service=new IssueLogService(repository,()=>({listAttachments:async(_s,_i,signal)=>new Promise((_resolve,reject)=>signal.addEventListener("abort",()=>reject(new AppError("CANCELLED","stopped")),{once:true}))}),vi.fn(),()=>{});const scope={connection:{kind:"trinity",platform:"trinity",baseUrl:"https://t"},binding:{owner:"a"}} as IssueScope;const pending=service.enqueue(scope,{remoteId:"b",updatedAt:"1"} as RemoteIssue);await service.shutdown();expect((await pending).status).toBe("FAILED");
});
