import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { AppError } from "../../contracts/src/error";
export interface SystemCipher {
  available(): boolean;
  encrypt(value: string): Buffer;
  decrypt(value: Buffer): string;
}
export class FileCredentialStore {
  constructor(
    private readonly directory: string,
    private readonly cipher: SystemCipher,
  ) {}
  private file(ref: string): string {
    if (!/^[a-f0-9-]{36}$/.test(ref))
      throw new AppError("INVALID_CREDENTIAL_REF", "凭据引用无效");
    return join(this.directory, `${ref}.bin`);
  }
  private requireEncryption(): void {
    if (!this.cipher.available())
      throw new AppError(
        "ENCRYPTION_UNAVAILABLE",
        "系统凭据加密不可用，拒绝保存明文",
      );
  }
  async save(_connectionId: string, secret: string): Promise<string> {
    this.requireEncryption();
    const ref = randomUUID();
    const encrypted = this.cipher.encrypt(secret);
    await mkdir(this.directory, { recursive: true });
    await writeFile(this.file(ref), encrypted, { mode: 0o600, flag: "wx" });
    return ref;
  }
  async resolve(ref: string): Promise<string> {
    const file = this.file(ref);
    this.requireEncryption();
    return this.cipher.decrypt(await readFile(file));
  }
  async remove(ref: string): Promise<void> {
    await unlink(this.file(ref));
  }
}
