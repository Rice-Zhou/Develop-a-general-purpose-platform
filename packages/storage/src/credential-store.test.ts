import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileCredentialStore } from "./credential-store";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
describe("credential boundary", () => {
  it("refuses saving when system encryption is unavailable", async () => {
    const root = await mkdtemp(join(tmpdir(), "local-platform-vault-"));
    roots.push(root);
    const vault = new FileCredentialStore(root, {
      available: () => false,
      encrypt: () => {
        throw new Error("must not encrypt");
      },
      decrypt: () => {
        throw new Error("must not decrypt");
      },
    });
    await expect(
      vault.save("connection-a", "private-token"),
    ).rejects.toMatchObject({ code: "ENCRYPTION_UNAVAILABLE" });
    expect(await readdir(root)).toEqual([]);
  });
  it("persists only cipher bytes and prevents arbitrary path resolution", async () => {
    const root = await mkdtemp(join(tmpdir(), "local-platform-vault-"));
    roots.push(root);
    // Test codec stands in for OS encryption; tests the real file boundary, not cryptographic strength.
    const vault = new FileCredentialStore(root, {
      available: () => true,
      encrypt: (value) => Buffer.from(Buffer.from(value).map((b) => b ^ 0xa7)),
      decrypt: (value) =>
        Buffer.from(Buffer.from(value).map((b) => b ^ 0xa7)).toString(),
    });
    const ref = await vault.save("connection-a", "private-token");
    expect(
      (await readFile(join(root, `${ref}.bin`))).includes(
        Buffer.from("private-token"),
      ),
    ).toBe(false);
    expect(await vault.resolve(ref)).toBe("private-token");
    await expect(vault.resolve("../other")).rejects.toMatchObject({
      code: "INVALID_CREDENTIAL_REF",
    });
  });
});
