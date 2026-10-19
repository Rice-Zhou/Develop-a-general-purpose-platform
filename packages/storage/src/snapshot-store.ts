import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, readdir, unlink, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { AppError } from '../../contracts/src/error';
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
export class SnapshotStore {
  constructor(private readonly directory: string) {}
  private path(hash: string): string { if (!/^[a-f0-9]{64}$/.test(hash)) throw new AppError('INVALID_HASH', '内容哈希无效'); return join(this.directory, hash); }
  async put(bytes: Buffer): Promise<{ hash: string; size: number }> {
    const hash = digest(bytes); await mkdir(this.directory, { recursive: true });
    const temporary = join(this.directory, `${randomUUID()}.tmp`); await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
    await rename(temporary, this.path(hash));
    return { hash, size: bytes.length };
  }
  async get(hash: string): Promise<Buffer> {
    const file = this.path(hash);
    if (!(await lstat(file)).isFile()) throw new AppError('CONTENT_TYPE_INVALID', '内容快照不是普通文件');
    const bytes = await readFile(file); if (digest(bytes) !== hash) throw new AppError('CONTENT_CORRUPTED', '内容快照哈希不匹配，拒绝返回损坏证据');
    return bytes;
  }
  async collectUnreferencedContent(referenced: Set<string>): Promise<{ deleted: number }> {
    await mkdir(this.directory, { recursive: true }); let deleted = 0;
    for (const entry of await readdir(this.directory, { withFileTypes: true })) {
      if (entry.isFile() && /^[a-f0-9]{64}$/.test(entry.name) && !referenced.has(entry.name)) { await unlink(this.path(entry.name)); deleted++; }
    }
    return { deleted };
  }
}
