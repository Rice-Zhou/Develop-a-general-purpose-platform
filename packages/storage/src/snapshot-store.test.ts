import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SnapshotStore } from "./snapshot-store";
import { DataStore } from "./database";
import { ProjectService } from "../../core/src/projects/project-service";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function root() {
  const path = await mkdtemp(join(tmpdir(), "local-platform-content-"));
  roots.push(path);
  return path;
}
describe("owned content and backups", () => {
  it("stores verified content and never deletes files outside its owned hash namespace", async () => {
    const path = await root();
    const content = new SnapshotStore(path);
    const a = await content.put(Buffer.from("reference"));
    const b = await content.put(Buffer.from("unused"));
    await writeFile(join(path, "original.docx"), "must keep");
    expect((await content.get(a.hash)).toString()).toBe("reference");
    await content.collectUnreferencedContent(new Set([a.hash]));
    await expect(content.get(b.hash)).rejects.toThrow();
    expect(await readFile(join(path, "original.docx"), "utf8")).toBe(
      "must keep",
    );
    await expect(content.get("../original.docx")).rejects.toMatchObject({
      code: "INVALID_HASH",
    });
  });
  it("detects modified bytes instead of returning corrupted evidence", async () => {
    const path = await root();
    const content = new SnapshotStore(path);
    const saved = await content.put(Buffer.from("original"));
    await writeFile(join(path, saved.hash), "changed");
    await expect(content.get(saved.hash)).rejects.toMatchObject({
      code: "CONTENT_CORRUPTED",
    });
  });
  it("creates a consistent reopenable database backup", async () => {
    const path = await root();
    const source = await DataStore.open(join(path, "source.db"));
    try {
      await new ProjectService(source).save({
        name: "备份项目",
        enabled: true,
        repositories: [
          { path, remoteName: "origin", branch: "main", role: "主仓库" },
        ],
        documents: [],
        issueBindings: [],
        aiProfileId: null,
      });
      await source.backup(join(path, "backup.db"));
      const backup = await DataStore.open(join(path, "backup.db"));
      try {
        expect(backup.listProjects()[0].name).toBe("备份项目");
      } finally {
        backup.close();
      }
    } finally {
      source.close();
    }
  });
});
