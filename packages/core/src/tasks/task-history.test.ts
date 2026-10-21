import {it,expect,vi} from "vitest";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
import {DataStore} from "../../../storage/src/database";
import {ProjectService} from "../projects/project-service";
import {TaskService,type TaskRuntime} from "./task-service";
import type {Task,Project} from "../../../contracts/src/models";
import type {RepositoryAdapter} from "../ports";
it("removes only terminal task history and preserves the record and events for report provenance",async()=>{
 const root=await mkdtemp(join(tmpdir(),"task-history-"));const store=await DataStore.open(join(root,"db"));let service:TaskService|undefined;
 try{
  const project:Project={id:randomUUID(),name:"P",revision:1,enabled:true,repositories:[],documents:[],issueBindings:[],aiProfileId:null,updatedAt:"now"};store.saveProject(project);
  service=new TaskService(store,new ProjectService(store),{} as RepositoryAdapter);
  const task:Task={id:randomUUID(),projectId:project.id,projectName:"P",kind:"DOWNLOAD_ISSUE_LOGS",status:"RUNNING",attempt:1,createdAt:"now",updatedAt:"now",error:null,contextSnapshotId:null};store.saveTask(task);store.event(task.id,"TEST","preserved");
  expect(()=>service!.delete(task.id)).toThrow(/先取消/);store.saveTask({...task,status:"SUCCEEDED"});service.delete(task.id);expect(service.list()).toHaveLength(0);expect(store.getTask(task.id).deletedAt).toBeTruthy();expect(store.taskEvents(task.id)).toHaveLength(1);await expect(service.retry(task.id)).rejects.toThrow(/已删除/);
 }finally{await service?.shutdown();store.close();await rm(root,{recursive:true,force:true});}
});
it("queues different issues while another analysis is running, deduplicates the same active issue, and cancels queued entries",async()=>{
 const root=await mkdtemp(join(tmpdir(),"bug-queue-"));const store=await DataStore.open(join(root,"db"));let service:TaskService|undefined;
 try{
  const project:Project={id:randomUUID(),name:"P",revision:1,enabled:true,repositories:[],documents:[],issueBindings:[],aiProfileId:null,updatedAt:"now"};store.saveProject(project);
  const prepare=vi.fn(async(_task:Task,signal:AbortSignal)=>new Promise<string>((_resolve,reject)=>signal.addEventListener("abort",()=>reject(new Error("cancelled")),{once:true})));
  service=new TaskService(store,new ProjectService(store),{} as RepositoryAdapter,{configurationHash:()=>"h",prepareIssue:prepare} as unknown as TaskRuntime);
  const first=await service.enqueue(project.id,"ANALYZE_BUG",1,undefined,"snapshot",undefined,{identity:"c:1",key:"BUG-1"});const duplicate=await service.enqueue(project.id,"ANALYZE_BUG",1,undefined,"other-snapshot",undefined,{identity:"c:1",key:"BUG-1"});const second=await service.enqueue(project.id,"ANALYZE_BUG",1,undefined,"snapshot2",undefined,{identity:"c:2",key:"BUG-2"});
  expect(duplicate.id).toBe(first.id);expect(service.get(second.id).status).toBe("QUEUED");await service.cancel(second.id);expect(service.get(second.id).status).toBe("CANCELLED");await service.cancel(first.id);
 }finally{await service?.shutdown();store.close();await rm(root,{recursive:true,force:true});}
});
