import {expect,it} from "vitest";
import {crc32} from "node:zlib";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {SnapshotStore} from "../../../storage/src/snapshot-store";
import {parseLogAttachment} from "./zip-reader";
function zip(rows:{name:string;bytes?:Buffer;mode?:number;encrypted?:boolean;declaredSize?:number;crc?:number}[]):Buffer {
 const bodies:Buffer[]=[];const central:Buffer[]=[];let offset=0;
 for(const row of rows){const name=Buffer.from(row.name);const bytes=row.bytes??Buffer.alloc(0);const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(row.encrypted?1:0,6);local.writeUInt32LE(row.crc??crc32(bytes),14);local.writeUInt32LE(bytes.length,18);local.writeUInt32LE(row.declaredSize??bytes.length,22);local.writeUInt16LE(name.length,26);bodies.push(local,name,bytes);
 const index=Buffer.alloc(46);index.writeUInt32LE(0x02014b50);index.writeUInt16LE(0x314,4);local.copy(index,6,4,28);index.writeUInt32LE(((row.mode??0o100644)<<16)>>>0,38);index.writeUInt32LE(offset,42);central.push(index,name);offset+=local.length+name.length+bytes.length;}
 const directory=Buffer.concat(central);const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(rows.length,8);end.writeUInt16LE(rows.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...bodies,directory,end]);
}
async function parse(bytes:Buffer){const root=await mkdtemp(join(tmpdir(),"zip-logs-"));try{const path=join(root,"logs.zip");await writeFile(path,bytes);const content=new SnapshotStore(join(root,"content"));const original=await content.put(bytes);return await parseLogAttachment(path,{id:"a",name:"logs.zip",mediaType:"application/zip",size:bytes.length,version:"v"},original.hash,content,new AbortController().signal);}finally{await rm(root,{recursive:true,force:true});}}
it("reads bounded ZIP entries as immutable text without extracting paths",async()=>{expect(await parse(zip([{name:"logs/app.log",bytes:Buffer.from("line1\nline2")}]))).toMatchObject([{path:"logs.zip/logs/app.log",status:"PARSED",lineCount:2}]);});
it.each(["../outside.txt","/abs.txt","C:/outside.txt","nested/../../outside.txt"])("rejects unsafe ZIP path %s",async name=>{await expect(parse(zip([{name}]))).rejects.toThrow();});
it("rejects duplicate paths, links, encryption, truncated archives and excessive nesting",async()=>{
 for(const bytes of [zip([{name:"a.txt"},{name:"A.txt"}]),zip([{name:"link",mode:0o120777}]),zip([{name:"a.txt",encrypted:true}]),zip([{name:"a.txt"}]).subarray(0,20),zip([{name:"inner.zip",bytes:zip([{name:"inner.zip",bytes:zip([{name:"a.txt"}])}])}])])await expect(parse(bytes)).rejects.toThrow();
});
it("rejects declared decompression bombs and more than 10000 entries",async()=>{
 await expect(parse(zip([{name:"bomb.txt",declaredSize:2*1024*1024*1024+1}]))).rejects.toThrow();
 await expect(parse(zip(Array.from({length:10001},(_,i)=>({name:`dir${i}/`,mode:0o40755}))))).rejects.toThrow();
});
it("rejects a mismatched ZIP CRC instead of publishing corrupted logs",async()=>{await expect(parse(zip([{name:"a.txt",bytes:Buffer.from("bad"),crc:1}]))).rejects.toThrow();});
