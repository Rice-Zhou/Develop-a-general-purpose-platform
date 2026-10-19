import { afterEach, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalDocumentSource } from './local-source';
const roots:string[]=[];
afterEach(async()=>{for(const path of roots.splice(0))await rm(path,{recursive:true,force:true});});
it('captures immutable bytes from a configured local source and rejects unsupported data',async()=>{
 const root=await mkdtemp(join(tmpdir(),'文档 capture-'));roots.push(root); const path=join(root,'需求.pdf');await writeFile(path,'%PDF-1.4\nfixture');
 const source=new LocalDocumentSource();const result=await source.fetch({id:'d',kind:'pdf',locator:path,required:true},new AbortController().signal);
 await writeFile(path,'changed');expect(result.bytes.toString()).toContain('%PDF-1.4');expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
 await expect(source.fetch({id:'d',kind:'pdf',locator:path,required:true},new AbortController().signal)).rejects.toMatchObject({code:'DOCUMENT_TYPE_MISMATCH'});
});
it('enforces file limits and cancellation before parsing',async()=>{
 const root=await mkdtemp(join(tmpdir(),'doc-limit-'));roots.push(root);const path=join(root,'a.pdf');await writeFile(path,'%PDF-1.4 too large');
 await expect(new LocalDocumentSource(8).fetch({id:'d',kind:'pdf',locator:path,required:true},new AbortController().signal)).rejects.toMatchObject({code:'DOCUMENT_SIZE_LIMIT'});
 const controller=new AbortController();controller.abort();await expect(new LocalDocumentSource().fetch({id:'d',kind:'pdf',locator:path,required:true},controller.signal)).rejects.toMatchObject({code:'CANCELLED'});
});
