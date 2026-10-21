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
