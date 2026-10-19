import { afterEach, describe, expect, it } from "vitest";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { GitRepositoryAdapter } from "./repository";
import { gitFixture, git } from "../../../testkit/src/git-fixture";

const fixtures: Awaited<ReturnType<typeof gitFixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.dispose();
});
it("retains evidence when unreachable commits are pruned from the analysis repository", async () => {
  const f = await setup();
  const snapshot = await adapter.synchronize(
    f.binding,
    new AbortController().signal,
  );
  await writeFile(join(f.analysis, "feature.txt"), "replacement");
  git(f.analysis, "add", ".");
  const tree = git(f.analysis, "write-tree");
  const orphan = git(
    f.analysis,
    "commit-tree",
    tree,
    "-m",
    "orphan replacement",
  );
  git(f.analysis, "update-ref", "refs/heads/main", orphan);
  git(f.analysis, "update-ref", "-d", "refs/remotes/origin/main");
  git(f.analysis, "reflog", "expire", "--expire=now", "--all");
  git(f.analysis, "gc", "--prune=now");
  expect((await adapter.readFile(snapshot, "feature.txt")).toString()).toBe(
    "initial\n",
  );
});
async function setup() {
  const f = await gitFixture();
  fixtures.push(f);
  return f;
}
const adapter = new GitRepositoryAdapter();
describe("current branch discovery", () => {
  it("reads a dirty repository without requiring a configured branch or changing files", async () => {
    const f = await setup();
    git(f.analysis, "switch", "-c", "analysis/custom");
    await writeFile(join(f.analysis, "feature.txt"), "developer changes");
    const before = git(f.analysis, "status", "--porcelain=v1");
    const result = await adapter.readCurrentBranch(f.analysis);
    expect(result.branch).toBe("analysis/custom");
    expect(git(f.analysis, "status", "--porcelain=v1")).toBe(before);
    expect(await readFile(join(f.analysis, "feature.txt"), "utf8")).toBe(
      "developer changes",
    );
  });
  it("distinguishes detached HEAD and rejects a child directory", async () => {
    const f = await setup();
    git(f.analysis, "switch", "--detach");
    expect((await adapter.readCurrentBranch(f.analysis)).branch).toBeNull();
    await expect(
      adapter.readCurrentBranch(join(f.analysis, ".git")),
    ).rejects.toThrow();
    await expect(
      adapter.readCurrentBranch("relative/path"),
    ).rejects.toMatchObject({ code: "INVALID_DIRECTORY" });
  });
});
describe("analysis repository synchronization", () => {
  it("fast-forwards a clean branch and pins subsequent reads to its commit", async () => {
    const f = await setup();
    const latest = await f.publish("latest\n");
    const snapshot = await adapter.synchronize(
      f.binding,
      new AbortController().signal,
    );
    expect(snapshot.commit).toBe(latest);
    await writeFile(join(f.analysis, "feature.txt"), "local edit");
    expect((await adapter.readFile(snapshot, "feature.txt")).toString()).toBe(
      "latest\n",
    );
  });
  it("does not lose local edits when the worktree is dirty", async () => {
    const f = await setup();
    await writeFile(join(f.analysis, "feature.txt"), "keep me");
    await expect(
      adapter.synchronize(f.binding, new AbortController().signal),
    ).rejects.toMatchObject({ code: "WORKTREE_DIRTY" });
    expect(await readFile(join(f.analysis, "feature.txt"), "utf8")).toBe(
      "keep me",
    );
    expect(git(f.analysis, "rev-parse", "HEAD")).toBe(f.initial);
  });
  it("rejects unpushed commits even when a fast-forward merge would report up-to-date", async () => {
    const f = await setup();
    await writeFile(join(f.analysis, "feature.txt"), "unpushed");
    git(f.analysis, "add", ".");
    git(f.analysis, "commit", "-m", "local");
    const local = git(f.analysis, "rev-parse", "HEAD");
    await expect(
      adapter.synchronize(f.binding, new AbortController().signal),
    ).rejects.toMatchObject({ code: "LOCAL_AHEAD" });
    expect(git(f.analysis, "rev-parse", "HEAD")).toBe(local);
  });
  it("rejects diverged histories without attempting a merge", async () => {
    const f = await setup();
    await f.publish("remote change");
    await writeFile(join(f.analysis, "feature.txt"), "local change");
    git(f.analysis, "add", ".");
    git(f.analysis, "commit", "-m", "local");
    await expect(
      adapter.synchronize(f.binding, new AbortController().signal),
    ).rejects.toMatchObject({ code: "BRANCH_DIVERGED" });
  });
  it("rejects mismatched branches, missing tracking refs and untracked content", async () => {
    const f = await setup();
    await expect(
      adapter.synchronize(
        { ...f.binding, branch: "other" },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "BRANCH_MISMATCH" });
    git(f.analysis, "branch", "--unset-upstream");
    await expect(
      adapter.synchronize(f.binding, new AbortController().signal),
    ).rejects.toMatchObject({ code: "TRACKING_MISSING" });
    git(f.analysis, "branch", "--set-upstream-to=origin/main");
    await writeFile(join(f.analysis, "new.txt"), "untracked");
    await expect(
      adapter.synchronize(f.binding, new AbortController().signal),
    ).rejects.toMatchObject({ code: "WORKTREE_DIRTY" });
  });
  it("fails a fetch rather than analyzing cached remote information", async () => {
    const f = await setup();
    git(f.analysis, "remote", "set-url", "origin", join(f.root, "missing.git"));
    await expect(
      adapter.synchronize(f.binding, new AbortController().signal),
    ).rejects.toMatchObject({ code: "GIT_FAILED" });
  });
  it("rejects path traversal and sensitive files from fixed-commit reads", async () => {
    const f = await setup();
    const snapshot = await adapter.synchronize(
      f.binding,
      new AbortController().signal,
    );
    await expect(adapter.readFile(snapshot, "../secret")).rejects.toMatchObject(
      { code: "PATH_DENIED" },
    );
    await expect(adapter.readFile(snapshot, ".env")).rejects.toMatchObject({
      code: "PATH_DENIED",
    });
  });
  it("rejects a newly introduced checkout filter before updating the worktree", async () => {
    const f = await setup();
    await writeFile(join(f.seed, ".gitattributes"), "*.txt filter=untrusted\n");
    git(f.seed, "add", ".");
    git(f.seed, "commit", "-m", "introduce filter");
    git(f.seed, "push", "origin", "main");
    await expect(
      adapter.synchronize(f.binding, new AbortController().signal),
    ).rejects.toMatchObject({ code: "FILTER_UNSUPPORTED" });
    expect(git(f.analysis, "rev-parse", "HEAD")).toBe(f.initial);
  });
  it("rejects repository-local attributes that introduce checkout filters", async () => {
    const f = await setup();
    await writeFile(
      join(f.analysis, ".git", "info", "attributes"),
      "*.txt filter=local-filter\n",
    );
    await expect(
      adapter.synchronize(f.binding, new AbortController().signal),
    ).rejects.toMatchObject({ code: "FILTER_UNSUPPORTED" });
  });
});
