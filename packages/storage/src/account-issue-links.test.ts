import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import Database from "better-sqlite3";
import { DataStore } from "./database";
import { IssueMonitor } from "../../core/src/issues/issue-monitor";
import { IssueService } from "../../core/src/issues/issue-service";
import type { Project } from "../../contracts/src/models";
import type { IssueConnection, RemoteIssue } from "../../contracts/src/issues";

it("deletes linked Jira connections and detaches active and disabled projects while preserving history", async () => {
 const dir = await mkdtemp(join(tmpdir(), "delete-jira-")); const store = await DataStore.open(join(dir, "app.db"));
 try {
  const jira: IssueConnection = {id:randomUUID(),kind:"jira-http",platform:"jira-dc",name:"Jira",baseUrl:"https://jira.example",username:"alice",credentialRef:null,bypassProxy:true,jiraProject:{key:"A",name:"Alpha",owner:"alice",issueTypeIds:["1"]}};
  const other = {...jira,id:randomUUID(),name:"Other Jira"};
  const trinity: IssueConnection = {id:randomUUID(),kind:"trinity",platform:"trinity",name:"Trinity",baseUrl:"https://trinity.example/trinity",accountId:"uid1",credentialRef:null,bypassProxy:true};
  store.setSetting("issue-connections",[jira,other,trinity]);
  const binding = {id:randomUUID(),connectionId:jira.id,platform:"jira-dc" as const,instanceUrl:jira.baseUrl,projectKey:"A",owner:"alice",issueTypeIds:["1"]};
  const base:Project = {id:randomUUID(),name:"Active",revision:1,enabled:true,repositories:[],documents:[{id:randomUUID(),kind:"docx",locator:"D:/requirements.docx",required:true}],issueBindings:[binding,{...binding,id:randomUUID(),connectionId:other.id}],aiProfileId:null,updatedAt:"now"};
  store.saveProject(base); const disabled = {...base,id:randomUUID(),name:"Disabled",enabled:false}; store.saveProject(disabled);
  const unrelated = {...base,id:randomUUID(),name:"Unrelated",issueBindings:[]};store.saveProject(unrelated);
  const issue:RemoteIssue = {remoteId:"1",key:"A-1",instanceUrl:jira.baseUrl,remoteProjectId:"A",ownerId:"alice",typeId:"1",title:"Bug",description:"Evidence",status:"Open",updatedAt:"now",versions:[],comments:[],attachments:[],warnings:[]};
  const service = new IssueService(store,()=>({list:async()=>[issue],get:async()=>issue}));
  const [snapshot] = await service.refresh(base.id,binding.id,undefined,new AbortController().signal);
  const db = new Database(join(dir,"app.db"));
  try {
   db.exec("CREATE TRIGGER reject_project_update BEFORE UPDATE ON projects BEGIN SELECT RAISE(ABORT, 'test project update failure'); END");
   expect(()=>service.deleteConnection(jira.id)).toThrow(/test project update failure/);
   expect(service.connections()).toHaveLength(3);
   expect(store.getProject(base.id).revision).toBe(1);
   expect(store.getProject(base.id).issueBindings[0].connectionId).toBe(jira.id);
   db.exec("DROP TRIGGER reject_project_update");
  } finally {db.close();}
  service.deleteConnection(jira.id);
  expect(service.connections().map(c=>c.id)).toEqual([other.id,trinity.id]);
  for (const project of [base,disabled]) {
   const saved=store.getProject(project.id);
   expect(saved.revision).toBe(2);
   expect(saved.issueBindings.map(b=>b.connectionId)).toEqual([other.id,trinity.id]);
   expect(saved.documents).toEqual(project.documents);expect(saved.enabled).toBe(project.enabled);
   expect(()=>store.saveProject({...project,revision:2},1)).toThrow(/配置已被更新/);
  }
  expect(store.getProject(unrelated.id).revision).toBe(1);
  expect(store.issues.get(base.id,snapshot.id).description).toBe("Evidence");
  expect(service.workspace(base.id).sources.some(s=>s.bindingId===binding.id)).toBe(false);
  expect(()=>service.analysisInput(base.id,snapshot.id)).toThrow();
  store.close();const reopened=await DataStore.open(join(dir,"app.db"));
  try {expect(reopened.getProject(base.id).issueBindings.some(b=>b.connectionId===jira.id)).toBe(false);} finally {reopened.close();}
 } finally {store.close();await rm(dir,{recursive:true,force:true});}
});

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
  const sent:string[]=[];const monitor=new IssueMonitor(store,service,{search:async()=>({users:[],hasMore:false}),self:async()=>({openId:"self",name:"Local"}),send:async event=>{sent.push(event.key);}});
  await monitor.refreshProject(projects[0].id);await monitor.refreshProject(projects[1].id);expect(sent).toEqual([]);
  rows.push(row("2"));await monitor.refreshProject(projects[0].id);await monitor.refreshProject(projects[1].id);expect(sent).toEqual(["BUG-2"]);
  rows.push(row("3"));await Promise.all(projects.map(p=>monitor.refreshProject(p.id)));expect(sent).toEqual(["BUG-2","BUG-3"]);
 }finally{store.close();await rm(dir,{recursive:true,force:true});}
});

it("adds many-to-many Trinity mappings without replacing documents, AI defaults or existing mappings", async()=>{
 const dir=await mkdtemp(join(tmpdir(),"trinity-mappings-"));const store=await DataStore.open(join(dir,"app.db"));
 try {
  const {ProjectService}=await import("../../core/src/projects/project-service");const service=new ProjectService(store);
  const connection:IssueConnection={id:randomUUID(),kind:"trinity",platform:"trinity",name:"Trinity",baseUrl:"https://trinity.example/trinity",accountId:"uid1",credentialRef:null,bypassProxy:true};store.setSetting("issue-connections",[connection]);
  const a:Project={id:randomUUID(),name:"空调",revision:1,enabled:true,repositories:[],documents:[],issueBindings:[],aiProfileId:null,updatedAt:"now"};const b={...a,id:randomUUID(),name:"车身"};store.saveProject(a);store.saveProject(b);
  const defaultAI=randomUUID(),nextAI=randomUUID();store.setSetting("profiles",[defaultAI,nextAI].map(id=>({id})));
  store.setSetting("default-ai-profile",defaultAI);
  const mapping={instanceUrl:connection.baseUrl,projectId:"P1",name:"车型项目"};
  const first=service.associateTrinityProject(a.id,1,mapping);const second=service.associateTrinityProject(first.id,first.revision,{...mapping,projectId:"P2"});
  expect(second.trinityProjects?.map(m=>m.projectId)).toEqual(["P1","P2"]);
  const repeated=service.associateTrinityProject(second.id,second.revision,{...mapping,instanceUrl:connection.baseUrl+"/"});
  expect(repeated.trinityProjects).toHaveLength(2);
  expect(service.associateTrinityProject(b.id,1,mapping).trinityProjects).toEqual([mapping]);
  expect(repeated.documents).toEqual(a.documents);expect(repeated.aiProfileId).toBe(defaultAI);expect(repeated.usesDefaultAI).toBe(true);
  expect(()=>service.associateTrinityProject(a.id,1,mapping)).toThrow(/配置已被更新/);
  expect(()=>service.associateTrinityProject(a.id,repeated.revision,{...mapping,instanceUrl:"https://other.example"})).toThrow();
  store.setDefaultAIProfile(nextAI);expect(store.getProject(a.id)).toMatchObject({aiProfileId:nextAI,usesDefaultAI:true});
  store.close();const reopened=await DataStore.open(join(dir,"app.db"));try{expect(reopened.getProject(a.id).trinityProjects).toHaveLength(2);}finally{reopened.close();}
 }finally{store.close();await rm(dir,{recursive:true,force:true});}
});
