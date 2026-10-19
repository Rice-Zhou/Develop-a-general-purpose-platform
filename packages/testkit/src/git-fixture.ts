import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "core.autocrlf=false", ...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
export async function gitFixture() {
  const root = await mkdtemp(join(tmpdir(), "local-platform-git-"));
  const remote = join(root, "remote.git");
  const seed = join(root, "seed");
  const analysis = join(root, "分析 代码");
  git(root, "init", "--bare", "--initial-branch=main", remote);
  git(root, "clone", remote, seed);
  git(seed, "config", "user.name", "Test");
  git(seed, "config", "user.email", "test@example.invalid");
  async function publish(content: string) {
    await writeFile(join(seed, "feature.txt"), content);
    git(seed, "add", ".");
    git(seed, "commit", "-m", "update");
    git(seed, "push", "origin", "main");
    return git(seed, "rev-parse", "HEAD");
  }
  const initial = await publish("initial\n");
  git(root, "clone", remote, analysis);
  git(analysis, "config", "user.name", "Test");
  git(analysis, "config", "user.email", "test@example.invalid");
  return {
    root,
    remote,
    seed,
    analysis,
    initial,
    publish,
    binding: {
      id: "repo-a",
      canonicalPath: analysis,
      remoteName: "origin",
      branch: "main",
      role: "主仓库",
      remoteUrlFingerprint: null,
    },
    dispose: () => rm(root, { recursive: true, force: true }),
  };
}
