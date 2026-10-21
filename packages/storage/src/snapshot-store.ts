import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  readdir,
  unlink,
  lstat,
  open,
} from "node:fs/promises";
import { join } from "node:path";
import { createReadStream } from "node:fs";
import { AppError } from "../../contracts/src/error";
const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
export class SnapshotStore {
  constructor(private readonly directory: string) {}
  private path(hash: string): string {
    if (!/^[a-f0-9]{64}$/.test(hash))
      throw new AppError("INVALID_HASH", "内容哈希无效");
    return join(this.directory, hash);
  }
  async put(bytes: Buffer): Promise<{ hash: string; size: number }> {
    const hash = digest(bytes);
    await mkdir(this.directory, { recursive: true });
    const temporary = join(this.directory, `${randomUUID()}.tmp`);
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
    await rename(temporary, this.path(hash));
    return { hash, size: bytes.length };
  }
  async putStream(source:AsyncIterable<Uint8Array>,limit:number,signal:AbortSignal):Promise<{hash:string;size:number}> {
    await mkdir(this.directory,{recursive:true});
    const temporary=join(this.directory,`${randomUUID()}.tmp`);
    const handle=await open(temporary,"wx",0o600);const hash=createHash("sha256");let size=0;
    try {
      for await(const part of source) {
        signal.throwIfAborted();size+=part.byteLength;
        if(size>limit)throw new AppError("MATERIAL_SIZE_LIMIT","日志实际大小超过预算，未发布部分文件");
        hash.update(part);let written=0;
        while(written<part.byteLength){const result=await handle.write(part,written,part.byteLength-written);if(!result.bytesWritten)throw new AppError("CONTENT_WRITE_FAILED","内容写入未取得进展");written+=result.bytesWritten;}
      }
      signal.throwIfAborted();await handle.sync();await handle.close();
      const value=hash.digest("hex");await rename(temporary,this.path(value));return {hash:value,size};
    } catch(error) {
      await handle.close();
      try {await unlink(temporary);}catch(cleanup){if((cleanup as NodeJS.ErrnoException).code!=="ENOENT")throw new AggregateError([error,cleanup],"内容写入失败且临时文件清理失败");}
      throw error;
    }
  }
  async get(hash: string): Promise<Buffer> {
    const file = this.path(hash);
    if (!(await lstat(file)).isFile())
      throw new AppError("CONTENT_TYPE_INVALID", "内容快照不是普通文件");
    const bytes = await readFile(file);
    if (digest(bytes) !== hash)
      throw new AppError(
        "CONTENT_CORRUPTED",
        "内容快照哈希不匹配，拒绝返回损坏证据",
      );
    return bytes;
  }
  async verifiedPath(hash:string):Promise<string> {
    const file=this.path(hash);if(!(await lstat(file)).isFile())throw new AppError("CONTENT_TYPE_INVALID","内容对象不是普通文件");
    const actual=createHash("sha256");for await(const part of createReadStream(file))actual.update(part as Buffer);
    if(actual.digest("hex")!==hash)throw new AppError("CONTENT_CORRUPTED","内容对象哈希不匹配");return file;
  }
  async readLines(hash:string,start:number,end:number,signal?:AbortSignal):Promise<{text:string;endLine:number}> {
    const file=await this.verifiedPath(hash);const decoder=new TextDecoder("utf-8",{fatal:true});let line=1;let selected="";let current="";
    for await(const bytes of createReadStream(file)) {
      signal?.throwIfAborted();const value=decoder.decode(bytes as Buffer,{stream:true});
      for(const segment of value.match(/[^\n]*\n|[^\n]+$/g)??[]) {
        if(line>=start&&line<=end){current+=segment;if(current.length+selected.length>32000)throw new AppError("TOOL_OUTPUT_LIMIT","日志片段超过 32000 字符，请缩小行范围");}
        if(segment.endsWith("\n")){if(line>=start&&line<=end){selected+=current;current="";}line++;if(line>end)return {text:selected.replace(/\r?\n$/,""),endLine:end};}
      }
    }
    const tail=decoder.decode();if(line>=start&&line<=end)current+=tail;
    return {text:(selected+current).replace(/\r?\n$/,""),endLine:Math.min(line,end)};
  }
  async collectUnreferencedContent(
    referenced: Set<string>,
  ): Promise<{ deleted: number }> {
    await mkdir(this.directory, { recursive: true });
    let deleted = 0;
    for (const entry of await readdir(this.directory, {
      withFileTypes: true,
    })) {
      if (
        entry.isFile() &&
        /^[a-f0-9]{64}$/.test(entry.name) &&
        !referenced.has(entry.name)
      ) {
        await unlink(this.path(entry.name));
        deleted++;
      }
    }
    return { deleted };
  }
}
