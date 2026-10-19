import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DataStore } from "./database";
import { ProjectService } from "../../core/src/projects/project-service";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "local-platform-store-"));
  roots.push(root);
  const repo = join(root, "代码 A");
  await mkdir(repo);
  const store = new DataStore(join(root, "app.db"));
  return { root, repo, store, service: new ProjectService(store) };
}
function draft(name: string, path: string) {
  return {
    name,
    enabled: true,
    repositories: [
      { path, remoteName: "origin", branch: "main", role: "主仓库" },
    ],
    documents: [],
    issueBindings: [],
    aiProfileId: null,
  };
}
describe("project persistence", () => {
  it("persists independent projects after reopening the database", async () => {
    const f = await fixture();
    const repoB = join(f.root, "B");
    await mkdir(repoB);
    try {
      const a = await f.service.save(draft("A", f.repo));
      const b = await f.service.save(draft("B", repoB));
      expect(a.id).not.toBe(b.id);
      f.store.close();
      const reopened = new DataStore(join(f.root, "app.db"));
      try {
        expect(
          new ProjectService(reopened)
            .list()
            .map((p) => p.name)
            .sort(),
        ).toEqual(["A", "B"]);
      } finally {
        reopened.close();
      }
    } finally {
      f.store.close();
    }
  });
  it("rejects duplicate paths including junction aliases", async () => {
    const f = await fixture();
    const alias = join(f.root, "alias");
    await symlink(f.repo, alias, "junction");
    try {
      await f.service.save(draft("A", f.repo));
      await expect(f.service.save(draft("B", alias))).rejects.toMatchObject({
        code: "PATH_IN_USE",
      });
    } finally {
      f.store.close();
    }
  });
  it("rejects stale writes without modifying the stored project", async () => {
    const f = await fixture();
    try {
      const a = await f.service.save(draft("A", f.repo));
      await f.service.save(
        { ...draft("Renamed", f.repo), id: a.id },
        a.revision,
      );
      await expect(
        f.service.save({ ...draft("Stale", f.repo), id: a.id }, a.revision),
      ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
      expect(f.service.list()[0].name).toBe("Renamed");
    } finally {
      f.store.close();
    }
  });
});
