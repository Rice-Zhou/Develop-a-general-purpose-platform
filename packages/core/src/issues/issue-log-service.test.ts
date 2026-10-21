import {expect,it,vi} from "vitest";
import {IssueLogService} from "./issue-log-service";
import type {IssueLogSet,IssueLogScope} from "../../../contracts/src/issue-materials";
import type {IssueScope,RemoteIssue} from "../../../contracts/src/issues";
it("deduplicates shared issue generations and never publishes an older completed download",async()=>{
 const sets:IssueLogSet[]=[];let release!:()=>void;const gate=new Promise<void>(r=>release=r);
 const repository={get:(id:string)=>sets.find(s=>s.id===id)!,latest:(_scope:IssueLogScope)=>sets.at(-1)??null,create:(set:IssueLogSet)=>{sets.push(set);},update:(set:IssueLogSet)=>{if(sets.at(-1)?.id!==set.id)return false;sets[sets.length-1]=set;return true;}};
 const download=vi.fn(async()=>{await gate;return [{id:"f",attachmentId:"a",path:"log.txt",originalHash:"h",contentHash:"h",size:1,encoding:"utf-8",lineCount:1,status:"PARSED" as const,error:null}];});
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
