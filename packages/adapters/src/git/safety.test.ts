import { afterEach, expect, it } from "vitest";
import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { gitFixture, git } from "../../../testkit/src/git-fixture";
import { GitRepositoryAdapter } from "./repository";
const fixtures: Awaited<ReturnType<typeof gitFixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.dispose();
});
async function setup() {
  const f = await gitFixture();
  fixtures.push(f);
  return f;
}
const adapter = new GitRepositoryAdapter();
it("does not overwrite ignored local content when a remote commit starts tracking that path", async () => {
  const f = await setup();
  await writeFile(join(f.seed, ".gitignore"), "cache.txt\n");
  git(f.seed, "add", ".");
  git(f.seed, "commit", "-m", "ignore cache");
  git(f.seed, "push", "origin", "main");
  await adapter.synchronize(f.binding, new AbortController().signal);
  const before = git(f.analysis, "rev-parse", "HEAD");
  await writeFile(join(f.analysis, "cache.txt"), "local must survive");
  await writeFile(join(f.seed, "cache.txt"), "remote");
  git(f.seed, "add", "-f", "cache.txt");
  git(f.seed, "commit", "-m", "track cache");
  git(f.seed, "push", "origin", "main");
  await expect(
    adapter.synchronize(f.binding, new AbortController().signal),
  ).rejects.toThrow();
  expect(await readFile(join(f.analysis, "cache.txt"), "utf8")).toBe(
    "local must survive",
  );
  expect(git(f.analysis, "rev-parse", "HEAD")).toBe(before);
});
it("rejects clean filters before status can execute them during inspection", async () => {
  const f = await setup();
  const marker = join(f.root, "filter-was-executed");
  const helper = join(f.root, "filter.cjs");
  await writeFile(
    helper,
    `require('node:fs').writeFileSync(${JSON.stringify(marker)},'executed');process.stdin.pipe(process.stdout);`,
  );
  await writeFile(join(f.analysis, ".gitattributes"), "*.txt filter=unsafe\n");
  git(f.analysis, "add", ".gitattributes");
  git(f.analysis, "commit", "-m", "attributes");
  git(
    f.analysis,
    "config",
    "filter.unsafe.clean",
    `"${process.execPath.replace(/\\/g, "/")}" "${helper.replace(/\\/g, "/")}"`,
  );
  await writeFile(
    join(f.analysis, "feature.txt"),
    "changed to force comparison\n",
  );
  await expect(adapter.inspect(f.binding)).rejects.toMatchObject({
    code: "FILTER_UNSUPPORTED",
  });
  await expect(stat(marker)).rejects.toMatchObject({ code: "ENOENT" });
});
it("recognizes unfinished operations in linked worktrees using their absolute Git paths", async () => {
  const f = await setup();
  const linked = join(f.root, "linked");
  git(f.analysis, "worktree", "add", "-b", "analysis-linked", linked, "main");
  git(linked, "branch", "--set-upstream-to=origin/main");
  const operation = git(linked, "rev-parse", "--git-path", "CHERRY_PICK_HEAD");
  await mkdir(join(f.root, "unused"), { recursive: true });
  await writeFile(operation, `${f.initial}\n`);
  const inspected = await adapter.inspect({
    ...f.binding,
    canonicalPath: linked,
    branch: "analysis-linked",
  });
  expect(inspected.blockingReasons).toContain("GIT_OPERATION_PENDING");
});
