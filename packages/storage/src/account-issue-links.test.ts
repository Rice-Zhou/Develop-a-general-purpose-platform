import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { DataStore } from "./database";
import { IssueMonitor } from "../../core/src/issues/issue-monitor";
import { IssueService } from "../../core/src/issues/issue-service";
import type { Project } from "../../contracts/src/models";
import type { IssueConnection, RemoteIssue } from "../../contracts/src/issues";

it("inherits one verified Trinity account for existing and future projects and routes only mapped bugs", async () => {
 const dir = await mkdtemp(join(tmpdir(), "account-issues-")); const store = await DataStore.open(join(dir,"app.db"));
 try {
  const base: Project = { id:randomUUID(), name:"A", revision:1, enabled:true, documents:[], repositories:[], issueBindings:[], aiProfileId:null, updatedAt:"now" };
  store.saveProject(base);
  const connection: IssueConnection = { id:randomUUID(), kind:"trinity", platform:"trinity", name:"Trinity", baseUrl:"https://trinity.example/trinity", username:"alice", accountId:"uid1", credentialRef:null, bypassProxy:true };
  store.setSetting("issue-connections",[connection]);
  expect(store.getProject(base.id).issueBindings).toHaveLength(1);
  expect(store.getProject(base.id).revision).toBe(2);
  const other = { ...base, id:randomUUID(), name:"B", trinityProjects:[{ instanceUrl:connection.baseUrl, projectId:"P2" }] };
  store.saveProject(other);
  expect(store.getProject(other.id).issueBindings).toHaveLength(1);
  const issue: RemoteIssue = {remoteId:"1",key:"BUG-1",instanceUrl:connection.baseUrl,remoteProjectId:"P2",ownerId:"uid1",typeId:"BUG",title:"Bug",description:"detail",status:"Open",updatedAt:"now",versions:[],comments:[],attachments:[],warnings:[]};
  const service = new IssueService(store,()=>({list:async()=>[issue],get:async()=>issue}));
  const binding = store.getProject(base.id).issueBindings[0];
  const [snapshot] = await service.refresh(base.id,binding.id,undefined,new AbortController().signal);
  expect(service.workspace(other.id).issues).toHaveLength(1);
  expect(()=>store.issues.replaceBatches([
   {projectId:base.id,bindingId:binding.id,scopeHash:snapshot.scopeHash,snapshots:[{...snapshot,id:randomUUID(),description:"must rollback"}]},
   {projectId:other.id,bindingId:binding.id,scopeHash:snapshot.scopeHash,snapshots:[snapshot]},
  ])).toThrow(/批次范围不一致/);
  expect(service.workspace(base.id).issues[0].description).toBe("detail");
  let release!:()=>void; const gate=new Promise<void>(resolve=>{release=resolve;});let reads=0;
  const concurrent=new IssueService(store,()=>({list:async()=>{reads++;await gate;return [issue];},get:async()=>issue}));
  const a=concurrent.refresh(base.id,binding.id,undefined,new AbortController().signal);
  const bRead=concurrent.refresh(other.id,binding.id,undefined,new AbortController().signal);
  release();const batches=await Promise.all([a,bRead]);expect(reads).toBe(1);expect(batches[1][0].projectId).toBe(other.id);


  expect(service.workspace(base.id).issues[0]).toMatchObject({analysisProjectId:other.id,analysisUnavailable:""});
  const input = service.analysisInput(base.id,snapshot.id);
  expect(input.projectId).toBe(other.id);
  expect(store.issues.get(other.id,input.issueSnapshotId).remoteProjectId).toBe("P2");
  const b = store.getProject(other.id); store.saveProject({...b,revision:b.revision+1,trinityProjects:[]},b.revision);
  expect(service.workspace(base.id).issues[0].analysisUnavailable).toContain("当前问题与所有项目不匹配，无法进行预分析");
  expect(()=>service.analysisInput(base.id,snapshot.id)).toThrow(/所有项目不匹配/);
  const replaced = {...connection,id:randomUUID(),accountId:"uid2",username:"bob"};
  store.setSetting("issue-connections",[replaced]);
  expect(store.getProject(base.id).issueBindings[0].owner).toBe("uid2");
  expect(()=>service.analysisInput(base.id,snapshot.id)).toThrow();
 } finally {store.close();await rm(dir,{recursive:true,force:true});}
});

it("uses the Jira project saved in a connection as the only binding metadata", async()=>{
 const dir=await mkdtemp(join(tmpdir(),"jira-link-"));const store=await DataStore.open(join(dir,"app.db"));
 try {
 const id=randomUUID(), pid=randomUUID();
 const connection:IssueConnection={id,kind:"jira-http",platform:"jira-dc",name:"Jira A",baseUrl:"https://jira.example",username:"alice",credentialRef:null,bypassProxy:true,jiraProject:{key:"A",name:"Alpha",owner:"alice",issueTypeIds:["1"]}};
 store.setSetting("issue-connections",[connection]);
 store.saveProject({id:pid,name:"Code",revision:1,enabled:true,repositories:[],documents:[],aiProfileId:null,updatedAt:"now",issueBindings:[{id:"b",connectionId:id,platform:"jira-dc",instanceUrl:connection.baseUrl,projectKey:"WRONG",owner:"wrong",issueTypeIds:["99"]}]});
 expect(store.getProject(pid).issueBindings[0]).toMatchObject({projectKey:"A",owner:"alice",issueTypeIds:["1"]});
 store.setSetting("issue-connections",[{...connection,jiraProject:{...connection.jiraProject!,key:"B"}}]);
 expect(store.getProject(pid).issueBindings[0].projectKey).toBe("B");expect(store.getProject(pid).revision).toBe(2);
 }finally{store.close();await rm(dir,{recursive:true,force:true});}
});

it("notifies once for the shared Trinity account across multiple code projects", async()=>{
 const dir=await mkdtemp(join(tmpdir(),"account-monitor-"));const store=await DataStore.open(join(dir,"app.db"));
 try{
  const c:IssueConnection={id:randomUUID(),kind:"trinity",platform:"trinity",name:"Trinity",baseUrl:"https://trinity.example/trinity",username:"alice",accountId:"uid1",credentialRef:null,bypassProxy:true};
  store.setSetting("issue-connections",[c]);
  const projects=["A","B"].map(name=>({id:randomUUID(),name,revision:1,enabled:true,repositories:[],documents:[],issueBindings:[],aiProfileId:null,updatedAt:"now"}));projects.forEach(p=>store.saveProject(p));
  const row=(id:string):RemoteIssue=>({remoteId:id,key:`BUG-${id}`,instanceUrl:c.baseUrl,remoteProjectId:"other",ownerId:"uid1",typeId:"BUG",title:"Bug",description:"",status:"Open",updatedAt:"now",versions:[],comments:[],attachments:[],warnings:[]});
  const rows=[row("1")];const service=new IssueService(store,()=>({list:async()=>rows,get:async(_s,key)=>rows.find(i=>i.key===key)!}));
  const sent:string[]=[];const monitor=new IssueMonitor(store,service,{self:async()=>({openId:"self",name:"Local"}),send:async event=>{sent.push(event.key);}});
  await monitor.refreshProject(projects[0].id);await monitor.refreshProject(projects[1].id);expect(sent).toEqual([]);
  rows.push(row("2"));await monitor.refreshProject(projects[0].id);await monitor.refreshProject(projects[1].id);expect(sent).toEqual(["BUG-2"]);
  rows.push(row("3"));await Promise.all(projects.map(p=>monitor.refreshProject(p.id)));expect(sent).toEqual(["BUG-2","BUG-3"]);
 }finally{store.close();await rm(dir,{recursive:true,force:true});}
});
