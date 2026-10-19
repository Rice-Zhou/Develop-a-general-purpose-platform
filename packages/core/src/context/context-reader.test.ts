import { expect,it } from 'vitest';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { randomUUID,createHash } from 'node:crypto';
import { gitFixture } from '../../../testkit/src/git-fixture';
import { DataStore } from '../../../storage/src/database';
import { SnapshotStore } from '../../../storage/src/snapshot-store';
import { ProjectService } from '../projects/project-service';
import { GitRepositoryAdapter } from '../../../adapters/src/git/repository';
import { ContextReader } from './context-reader';
import { SearchService } from '../search/search-service';
import { RequirementService } from '../requirements/requirement-service';
it('reads and searches pinned project evidence and versions manual requirements without crossing projects',async()=>{
 const f=await gitFixture();const store=await DataStore.open(join(f.root,'app.db'));const content=new SnapshotStore(join(f.root,'content'));const git=new GitRepositoryAdapter();
 try{
  const project=await new ProjectService(store).save({name:'A',enabled:true,repositories:[{path:f.analysis,remoteName:'origin',branch:'main',role:'main'}],documents:[],issueBindings:[],aiProfileId:null});
  const repository=await git.synchronize(project.repositories[0],new AbortController().signal);const saved=await content.put(Buffer.from('source'));const documentId=randomUUID();
  store.saveDocument({schemaVersion:1,id:documentId,projectId:project.id,bindingId:'d',kind:'docx',sourceLocator:'original.docx',contentHash:saved.hash,sourceRevision:null,parserVersion:'test-1',fetchedAt:new Date().toISOString(),blocks:[{id:'b',kind:'paragraph',text:'登录必须完成密码验证',headingPath:[],anchor:{label:'段落 1'},warnings:[]}],warnings:[]});
  const context={id:randomUUID(),projectId:project.id,configRevision:1,repositories:[repository],documents:[{id:documentId,bindingId:'d',contentHash:saved.hash,kind:'docx' as const}],createdAt:new Date().toISOString(),limitations:[]};
  const task={id:randomUUID(),projectId:project.id,projectName:'A',kind:'PREPARE_CONTEXT' as const,status:'PREPARING' as const,attempt:1,createdAt:context.createdAt,updatedAt:context.createdAt,error:null,contextSnapshotId:null};store.saveTask(task);store.completeTask(task,context);
  const reader=new ContextReader(context,store,git,content);
  await writeFile(join(f.analysis,'feature.txt'),'changed worktree');expect((await reader.readCode(repository.bindingId,'feature.txt',1,1)).text).toContain('initial');
  await expect(reader.readCode(repository.bindingId,'../secret',1,1)).rejects.toMatchObject({code:'PATH_DENIED'});
  expect(()=>new ContextReader({...context,projectId:'other'},store,git,content).readBlock(documentId,'b')).toThrow();
  const search=new SearchService(store);await search.index(reader,new AbortController().signal);expect(search.search(context,'密码',20).results).toHaveLength(1);expect(search.search(context,'密码验证',20).results).toHaveLength(1);
  const refs=[{documentSnapshotId:documentId,blockId:'b',quoteHash:createHash('sha256').update('登录必须完成密码验证').digest('hex')}];
  const service=new RequirementService(store);const set=service.saveRevision(reader,[{id:randomUUID(),text:'验证密码',acceptanceCriteria:['为空时拒绝'],sourceRefs:refs,clarification:'',reviewed:true}],0);
  expect(set.revision).toBe(1);expect(()=>service.saveRevision(reader,set.items,0)).toThrow();expect(()=>service.saveRevision(reader,[{...set.items[0],sourceRefs:[{...refs[0],quoteHash:'0'.repeat(64)}]}],1)).toThrow();
 }finally{store.close();await f.dispose();}
});
