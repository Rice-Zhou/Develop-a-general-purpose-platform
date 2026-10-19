import { expect,it } from 'vitest';
import { DocumentService } from './document-service';
import { AppError } from '../../../contracts/src/error';
it('blocks required sources but records an optional missing source as a visible gap',async()=>{
 const failed={fetch:async()=>{throw new AppError('DOCUMENT_UNREADABLE','missing');}};
 const docs=new DocumentService(failed,{parse:async()=>{throw new Error('must not parse');}},{put:async()=>{throw new Error('must not store');}}, {saveDocument:()=>{throw new Error('must not save');}});
 const project={id:'p',documents:[{id:'d',kind:'pdf' as const,locator:'absent',required:false}]};
 const optional=await docs.captureProject(project,new AbortController().signal);expect(optional.documents).toEqual([]);expect(optional.sourceGaps[0]).toMatchObject({required:false,code:'DOCUMENT_UNREADABLE'});
 await expect(docs.captureProject({...project,documents:[{...project.documents[0],required:true}]},new AbortController().signal)).rejects.toMatchObject({code:'DOCUMENT_UNREADABLE'});
});
