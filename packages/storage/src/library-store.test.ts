import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect } from "vitest";
import { DataStore } from "./database";

it("manages standalone categories and references without projects and rejects cycles", async () => {
 const dir=await mkdtemp(join(tmpdir(),"library-")); const store=await DataStore.open(join(dir,"db"));
 try {
  const parent=store.saveLibraryCategory({name:"UI",parentId:null});
  const child=store.saveLibraryCategory({name:"E0V",parentId:parent.id});
  expect(()=>store.saveLibraryCategory({...parent,parentId:child.id},parent.revision)).toThrow(/循环/);
  const resource=store.saveLibraryResource({name:"设计",kind:"url",locator:"https://example.com/ui",categoryId:child.id,purpose:"ui",notes:""});
  const moved=store.saveLibraryResource({...resource,categoryId:null},resource.revision);
  expect(moved.contentRevision).toBe(resource.contentRevision);
  expect(()=>store.deleteLibraryCategory(parent.id,parent.revision)).toThrow(/非空/);
  store.deleteLibraryCategory(child.id,child.revision);
  expect(()=>store.saveLibraryResource({...moved,categoryId:child.id},moved.revision)).toThrow(/分类/);
  const note=store.saveLibraryResource({name:"说明",kind:"note",text:"初期规划",purpose:"general",categoryId:null,notes:""});
  const path=store.saveLibraryResource({name:"目录",kind:"path",locator:"Z:/not-mounted",purpose:"general",categoryId:null,notes:""});
  expect(store.getLibrary().resources.map(r=>r.id)).toEqual([resource.id,note.id,path.id]);
  expect(()=>store.saveLibraryResource({...moved,name:"old"},1)).toThrow(/版本|更新/);
 } finally {store.close();await rm(dir,{recursive:true,force:true});}
});

it("keeps reference associations when the legacy document editor saves and protects shared resources",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"library-link-"));const store=await DataStore.open(join(dir,"db"));
 try{
  const ref=store.saveLibraryResource({name:"UI",kind:"path",locator:"D:/future",purpose:"ui",categoryId:null,notes:""});
  const project={id:randomUUID(),name:"A",revision:1,enabled:true,repositories:[],documents:[],issueBindings:[],aiProfileId:null,updatedAt:new Date().toISOString()};
  store.saveProject(project);
  const saved=store.saveProjectResources(project.id,[{resourceId:ref.id,role:"reference",required:false}],1);
  expect(saved.documents).toEqual([]);
  store.saveProject({...saved,revision:3,documents:[]},2);
  expect(store.getProject(project.id).resourceLinks).toEqual([{resourceId:ref.id,role:"reference",required:false}]);
  expect(()=>store.deleteLibraryResource(ref.id,ref.revision)).toThrow(/关联/);
  store.saveProjectResources(project.id,[],3);
  store.deleteLibraryResource(ref.id,ref.revision);
 }finally{store.close();await rm(dir,{recursive:true,force:true});}
});
