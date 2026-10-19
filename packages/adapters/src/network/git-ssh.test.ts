import { expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { gitEnvironment } from "./policy";
it("disables SSH proxies while preserving configured identity files", async () => {
  const root = await mkdtemp(join(tmpdir(), "git-direct-ssh-"));
  try {
    const config = join(root, "config");
    await writeFile(
      config,
      "Host example.invalid\n  IdentityFile ~/.ssh/preserved_identity\n  ProxyCommand must-not-run\n  ProxyJump jump.invalid\n",
    );
    const env = gitEnvironment({
      ...process.env,
      GIT_SSH_COMMAND: "must-not-run",
      GIT_SSH: "untrusted-ssh",
      GIT_SSH_VARIANT: "plink",
    });
    const command = env.GIT_SSH_COMMAND!.split(" ");
    const plan = execFileSync(
      command[0],
      [...command.slice(1), "-G", "-F", config, "example.invalid"],
      {
        env,
        encoding: "utf8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    expect(plan).not.toMatch(/must-not-run|jump.invalid/);
    expect(plan).toContain("preserved_identity");
    expect(env.GIT_SSH).toBeUndefined();
    expect(env.GIT_SSH_VARIANT).toBe("ssh");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
