import { expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileCredentialStore } from "./credential-store";
it("binds encrypted keys to their owning connection", async () => {
  const root = await mkdtemp(join(tmpdir(), "vault-scope-"));
  try {
    const vault = new FileCredentialStore(root, {
      available: () => true,
      encrypt: (v) => Buffer.from(v),
      decrypt: (v) => v.toString(),
    });
    const ref = await vault.save("owner", "secret");
    await expect(vault.resolve(ref, "different")).rejects.toMatchObject({
      code: "CREDENTIAL_SCOPE_MISMATCH",
    });
    expect(await vault.resolve(ref, "owner")).toBe("secret");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
