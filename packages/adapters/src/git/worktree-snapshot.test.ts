import { expect, it } from "vitest";
import { writeFile, unlink, mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { gitFixture, git } from "../../../testkit/src/git-fixture";
import { SnapshotStore } from "../../../storage/src/snapshot-store";
import { captureWorktree, assertWorktreeCurrent } from "./worktree-snapshot";
it("captures staged, dirty and untracked bytes without changing Git or switching a mismatched branch", async () => {
  const f=await gitFixture();
  try {
    const content=new SnapshotStore(join(f.root,"objects"));
    await writeFile(join(f.analysis,"feature.txt"),"staged"); git(f.analysis,"add","feature.txt");
    await writeFile(join(f.analysis,"feature.txt"),"current dirty"); await writeFile(join(f.analysis,"new.txt"),"untracked");
    const before=git(f.analysis,"diff","--cached"); const head=git(f.analysis,"rev-parse","HEAD");
    const snapshot=await captureWorktree({...f.binding,branch:"different"},content,new AbortController().signal);
    expect(snapshot).toMatchObject({kind:"worktree",branch:"main",commit:head,dirty:true});
    const file=snapshot.files.find(x=>x.path==="feature.txt")!;
    expect((await content.get(file.contentHash)).toString()).toBe("current dirty");
    expect(snapshot.files.some(x=>x.path==="new.txt")).toBe(true);
    expect(git(f.analysis,"diff","--cached")).toBe(before); expect(git(f.analysis,"rev-parse","HEAD")).toBe(head);
    await writeFile(join(f.analysis,"feature.txt"),"changed later");
    expect((await content.get(file.contentHash)).toString()).toBe("current dirty");
    await expect(assertWorktreeCurrent(snapshot,new AbortController().signal)).rejects.toMatchObject({code:"WORKTREE_CHANGED"});
  } finally {await f.dispose();}
});
it("honors deletions and excludes sensitive, ignored, generated files and directory links", async () => {
  const f=await gitFixture();
  try {
    await unlink(join(f.analysis,"feature.txt")); await writeFile(join(f.analysis,".env"),"secret");
    await writeFile(join(f.analysis,".gitignore"),"ignored/\n");
    for(const dir of ["build","ignored"]) {await mkdir(join(f.analysis,dir));await writeFile(join(f.analysis,dir,"out.txt"),"excluded");}
    await symlink(f.seed,join(f.analysis,"external"),"junction");
    const snapshot=await captureWorktree(f.binding,new SnapshotStore(join(f.root,"objects")),new AbortController().signal);
    expect(snapshot.files.map(x=>x.path)).toEqual([".gitignore"]);
    expect(snapshot.excluded).toContain(".env"); expect(snapshot.excluded).toContain("external");
    git(f.analysis,"checkout","--detach");
    const detached=await captureWorktree(f.binding,new SnapshotStore(join(f.root,"objects")),new AbortController().signal);
    expect(detached.branch).toBeNull();
  } finally {await f.dispose();}
});
it("rejects oversized files without silently omitting them",async()=>{
  const f=await gitFixture();try{
    await writeFile(join(f.analysis,"large.txt"),Buffer.alloc(4*1024*1024+1,65));
    await expect(captureWorktree(f.binding,new SnapshotStore(join(f.root,"objects")),new AbortController().signal)).rejects.toMatchObject({code:"FILE_SIZE_LIMIT"});
  }finally{await f.dispose();}
});
it("rejects a same-content delete and recreate during capture",async()=>{
  const f=await gitFixture();try{
    const content=new SnapshotStore(join(f.root,"objects"));let mutated=false;
    await expect(captureWorktree(f.binding,{async put(bytes){
      const stored=await content.put(bytes);
      if(!mutated){mutated=true;await unlink(join(f.analysis,"feature.txt"));await writeFile(join(f.analysis,"feature.txt"),bytes);}
      return stored;
    }},new AbortController().signal)).rejects.toMatchObject({code:"WORKTREE_CHANGED"});
  }finally{await f.dispose();}
});
