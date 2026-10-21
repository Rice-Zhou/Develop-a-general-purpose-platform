import {expect,it} from "vitest";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {SnapshotStore} from "../../../storage/src/snapshot-store";
import {parseLogAttachment} from "./zip-reader";
import {gzipSync} from "node:zlib";
it("parses the real platform's txt.gz format and rejects corrupted gzip streams",async()=>{
 const root=await mkdtemp(join(tmpdir(),"gzip-log-"));try{
  const content=new SnapshotStore(join(root,"content"));const bytes=gzipSync(Buffer.from("observed error\nsecond line"));const path=join(root,"device.txt.gz");await writeFile(path,bytes);const original=await content.put(bytes);
  const files=await parseLogAttachment(path,{id:"a",name:"device.txt.gz",size:bytes.length,mediaType:"application/gzip",version:"v"},original.hash,content,new AbortController().signal);
  expect(files[0].status).toBe("PARSED");expect((await content.get(files[0].contentHash!)).toString()).toContain("observed error");
  bytes[bytes.length-5]^=255;await writeFile(path,bytes);
  await expect(parseLogAttachment(path,{id:"a",name:"device.txt.gz",size:bytes.length,mediaType:"application/gzip",version:"v"},original.hash,content,new AbortController().signal)).rejects.toThrow();
 }finally{await rm(root,{recursive:true,force:true});}
});
it("parses UTF-8 and BOM UTF-16 while preserving unsupported binary originals",async()=>{
 const root=await mkdtemp(join(tmpdir(),"log-reader-"));try{
  const content=new SnapshotStore(join(root,"content"));
  for(const [name,bytes,expected] of [["a.log",Buffer.from("first\nsecond"),"first\nsecond"],["b.txt",Buffer.concat([Buffer.from([255,254]),Buffer.from("日志\n二","utf16le")]),"日志\n二"],["c.bin",Buffer.from([0,1,2]),null]] as const){
   const path=join(root,name);await writeFile(path,bytes);const original=await content.put(bytes);
   const files=await parseLogAttachment(path,{id:"a",name,mediaType:"",size:bytes.length,version:"v"},original.hash,content,new AbortController().signal);
   expect(files[0].originalHash).toBe(original.hash);
   if(expected){expect(files[0].status).toBe("PARSED");expect((await content.get(files[0].contentHash!)).toString()).toBe(expected);expect(files[0].lineCount).toBe(2);}else expect(files[0].status).toBe("UNSUPPORTED");
  }
 }finally{await rm(root,{recursive:true,force:true});}
});
