import {expect,it} from "vitest";
import {mkdtemp,rm,readdir} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import Database from "better-sqlite3";
import {DataStore} from "./database";
import {IssueMaterialRepository} from "./issue-material-repository";
import type {IssueLogSet} from "../../contracts/src/issue-materials";
it("backs up v8 and atomically rejects stale generations while keeping referenced history",async()=>{
 const root=await mkdtemp(join(tmpdir(),"materials-")); const path=join(root,"app.db");
 try{
  (await DataStore.open(path)).close();const old=new Database(path);old.exec("DROP TABLE requirement_review_reports; DROP TABLE requirement_review_events; DROP TABLE requirement_reviews; DROP TABLE project_resource_links; DROP TABLE library_resources; DROP TABLE library_categories;");old.pragma("user_version=8");old.close();(await DataStore.open(path)).close();
  expect((await readdir(root)).some(p=>p.includes("backup-v8"))).toBe(true);
  const db=new Database(path);try{
   const repository=new IssueMaterialRepository(db);
   const value:IssueLogSet={id:"one",scope:{platform:"trinity",instanceUrl:"https://t",accountId:"a",remoteIssueId:"b"},issueVersion:"v",generation:1,status:"QUEUED",attachments:[],files:[],manifestHash:"hash",error:null,updatedAt:"now"};
   repository.create(value);repository.create({...value,id:"two",generation:2});
   expect(repository.update({...value,status:"READY"})).toBe(false);
   expect(repository.latest(value.scope)?.id).toBe("two");expect(repository.get("one").id).toBe("one");
   repository.update({...value,id:"two",generation:2,status:"DOWNLOADING"});repository.recoverInterrupted();expect(repository.get("two").status).toBe("FAILED");
  }finally{db.close();}
 }finally{await rm(root,{recursive:true,force:true});}
});
