import {expect,it,vi} from "vitest";
import {mkdtemp,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {randomUUID} from "node:crypto";
import {DataStore} from "./database";
import {TaskService} from "../../core/src/tasks/task-service";
import {ProjectService} from "../../core/src/projects/project-service";
import {AppError} from "../../contracts/src/error";
it("requires logs before code and captures current code without Git synchronization; retries preserve code-only",async()=>{
 const root=await mkdtemp(join(tmpdir(),"bug-current-"));const store=await DataStore.open(join(root,"app.db"));const id=randomUUID();
 store.saveProject({id,name:"P",revision:1,enabled:true,updatedAt:"now",aiProfileId:"ai",documents:[],issueBindings:[],repositories:[{id:"repo",canonicalPath:root,remoteName:"origin",branch:"configured",role:"main",remoteUrlFingerprint:null}]});
 const forbidden=vi.fn(()=>{throw new Error("Git synchronization must never run for BUG analysis");});
 const captureCurrentCode=vi.fn(async()=>({kind:"worktree" as const,bindingId:"repo",canonicalPath:root,branch:"actual",commit:null,capturedAt:"now",manifestHash:"m",dirty:true,files:[],excluded:[]}));
 const runtime={configurationHash:()=>"same",prepareIssue:async()=>"issue",prepareIssueMaterials:vi.fn(async(task:import("../../contracts/src/models").Task)=>{if(task.bugOptions?.logPolicy!=="code-only")throw new AppError("ISSUE_LOG_REQUIRED","download failed");return undefined;}),captureCurrentCode,captureDocuments:async()=>({documents:[],sourceGaps:[]}),indexContext:async()=>[],analyze:async()=>{throw new AppError("BUG_EVIDENCE_INSUFFICIENT","fixture stops after capture");}};
 const tasks=new TaskService(store,new ProjectService(store),{inspect:forbidden,assertReady:forbidden,synchronize:forbidden},runtime);
 try{
  const required=await tasks.enqueue(id,"ANALYZE_BUG",1,undefined,"issue");await expect.poll(()=>tasks.get(required.id).status).toBe("WAITING_INPUT");expect(captureCurrentCode).not.toHaveBeenCalled();
  const only=await tasks.enqueue(id,"ANALYZE_BUG",1,undefined,"issue",{logPolicy:"code-only"});await expect.poll(()=>tasks.get(only.id).status).toBe("WAITING_INPUT");expect(captureCurrentCode).toHaveBeenCalledOnce();expect(forbidden).not.toHaveBeenCalled();
  const retry=await tasks.retry(only.id);expect(retry.bugOptions).toEqual({logPolicy:"code-only"});
 }finally{await tasks.shutdown();store.close();await rm(root,{recursive:true,force:true});}
});
