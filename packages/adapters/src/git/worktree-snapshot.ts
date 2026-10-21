import { createHash } from "node:crypto";
import { open, lstat, realpath } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import type { RepositoryBinding, WorktreeRepositorySnapshot } from "../../../contracts/src/models";
import { AppError } from "../../../contracts/src/error";
import { readablePath } from "../../../core/src/context/access-policy";
import { runGit } from "./git-process";
const MAX_FILE = 4 * 1024 * 1024;
const MAX_TOTAL = 512 * 1024 * 1024;
const MAX_FILES = 20000;
const generated = /(^|\/)(node_modules|build|dist|out|target|\.gradle|\.idea|\.vite|coverage)($|\/)/i;
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const changed = () => new AppError("WORKTREE_CHANGED", "当前工作区在快照捕获或分析期间发生变化，请重新分析");
async function text(root:string,args:string[],signal:AbortSignal,allowed=[0]) {return (await runGit(root,args,signal,allowed)).stdout.toString("utf8").trim();}
async function readStable(root:string,path:string) {
  const parts=path.split("/");
  for(let i=1;i<=parts.length;i++) {
    const candidate=join(root,...parts.slice(0,i));
    const info=await lstat(candidate);
    if(info.isSymbolicLink()) throw new AppError("WORKTREE_LINK", "链接文件及链接目录不进入代码快照");
    const resolved=await realpath(candidate); const rel=relative(root,resolved);
    if(rel.startsWith("..")||isAbsolute(rel)) throw new AppError("PATH_DENIED","工作区路径越界");
  }
  const location=join(root,path); const before=await lstat(location);
  if(!before.isFile()) throw new AppError("WORKTREE_LINK","非普通文件不进入代码快照");
  if(before.size>MAX_FILE) throw new AppError("FILE_SIZE_LIMIT",`代码文件超过 4 MiB：${path}`);
  const handle=await open(location,"r");
  try {
    const opened=await handle.stat();
    if(before.ino!==opened.ino||before.dev!==opened.dev||before.ctimeMs!==opened.ctimeMs)throw changed();
    // Bound the read even when another process grows the file after stat.
    const buffer=Buffer.alloc(MAX_FILE+1); let length=0;
    while(length<buffer.length) {const part=await handle.read(buffer,length,buffer.length-length,null);if(!part.bytesRead)break;length+=part.bytesRead;}
    if(length>MAX_FILE)throw new AppError("FILE_SIZE_LIMIT",`代码文件超过 4 MiB：${path}`);
    const after=await handle.stat(); const current=await lstat(location);
    if(current.isSymbolicLink()||current.ino!==before.ino||current.ctimeMs!==before.ctimeMs||after.size!==before.size||after.mtimeMs!==before.mtimeMs||length!==before.size)throw changed();
    return {bytes:buffer.subarray(0,length),identity:[path,before.dev,before.ino,before.ctimeMs,before.mtimeMs,before.mode]};
  } finally {await handle.close();}
}
async function scan(root:string,signal:AbortSignal,content?:{put(bytes:Buffer):Promise<{hash:string}>}) {
  const listed=(await runGit(root,["ls-files","--cached","--others","--exclude-standard","-z"],signal)).stdout.toString("utf8").split("\0").filter(Boolean);
  const paths=[...new Set(listed)].sort();
  if(paths.length>MAX_FILES)throw new AppError("WORKTREE_LIMIT","工作区路径超过 20000 个，未发布不完整快照");
  const files:WorktreeRepositorySnapshot["files"]=[]; const excluded:string[]=[]; const identities:unknown[]=[];let total=0;
  for(const path of paths) {
    signal.throwIfAborted();
    if(!readablePath(path)||generated.test(path)) {excluded.push(path);continue;}
    let captured:Awaited<ReturnType<typeof readStable>>;
    try {captured=await readStable(root,path);}
    catch(error) {
      if((error as NodeJS.ErrnoException).code==="ENOENT")continue;
      if(error instanceof AppError&&error.code==="WORKTREE_LINK") {excluded.push(path.replace(/\/$/,""));continue;}
      throw error;
    }
    const {bytes,identity}=captured;
    total+=bytes.length;if(total>MAX_TOTAL)throw new AppError("WORKTREE_LIMIT","代码内容超过 512 MiB，未发布不完整快照");
    const contentHash=digest(bytes);
    identities.push(identity);
    if(content)await content.put(bytes);
    files.push({path,contentHash,size:bytes.length});
  }
  const commit=await text(root,["rev-parse","--verify","HEAD"],signal,[0,128]);
  const branch=await text(root,["symbolic-ref","--quiet","--short","HEAD"],signal,[0,1]);
  const index=await text(root,["ls-files","--stage","-z"],signal);
  const manifestHash=digest(JSON.stringify({files,excluded,branch,commit,index,identities}));
  return {files,excluded,commit:/^[a-f0-9]{40,64}$/.test(commit)?commit:null,branch:branch||null,index,manifestHash};
}
export async function captureWorktree(binding:RepositoryBinding, content:{put(bytes:Buffer):Promise<{hash:string}>}, signal:AbortSignal):Promise<WorktreeRepositorySnapshot> {
  const root=await realpath(binding.canonicalPath);
  const first=await scan(root,signal,content);const second=await scan(root,signal);
  if(first.manifestHash!==second.manifestHash)throw changed();
  // Compare raw worktree bytes with HEAD without invoking Git filters or changing the index.
  const algorithm=await text(root,["rev-parse","--show-object-format"],signal);
  const headFiles=first.commit ? (await runGit(root,["ls-tree","-r","-z",first.commit],signal)).stdout.toString("utf8").split("\0").filter(Boolean) : [];
  const tree=new Map(headFiles.map(row=>{const [meta,path]=row.split("\t");return [path,meta.split(" ")[2]];}));
  let dirty=!first.commit;
  for(const file of first.files) {const {bytes}=await readStable(root,file.path);if(digest(bytes)!==file.contentHash)throw changed();const blob=createHash(algorithm).update(`blob ${bytes.length}\0`).update(bytes).digest("hex");if(tree.get(file.path)!==blob)dirty=true;tree.delete(file.path);}
  if([...tree.keys()].some(path=>readablePath(path)&&!generated.test(path)))dirty=true;
  return {kind:"worktree",bindingId:binding.id,canonicalPath:root,branch:first.branch,commit:first.commit,capturedAt:new Date().toISOString(),manifestHash:first.manifestHash,dirty,files:first.files,excluded:first.excluded};
}
export async function assertWorktreeCurrent(snapshot:WorktreeRepositorySnapshot,signal:AbortSignal) {
  if((await realpath(snapshot.canonicalPath))!==snapshot.canonicalPath || (await scan(snapshot.canonicalPath,signal)).manifestHash!==snapshot.manifestHash)throw changed();
}
