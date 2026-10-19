import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  rm,
  symlink,
  writeFile,
  readFile,
  readdir,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DataStore } from "./database";
import Database from "better-sqlite3";
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
  const store = await DataStore.open(join(root, "app.db"));
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
  it("backs up v3 before enforcing removal semantics in the database version", async () => {
    const f = await fixture();
    const p = await f.service.save(draft("A", f.repo));
    f.store.close();
    const old = new Database(join(f.root, "app.db"));
    old.pragma("user_version = 3");
    old.close();
    const upgraded = await DataStore.open(join(f.root, "app.db"));
    try {
      expect(upgraded.getProject(p.id)).toEqual(p);
      expect(
        (await readdir(f.root)).some((name) => name.includes("backup-v3")),
      ).toBe(true);
    } finally {
      upgraded.close();
    }
    const check = new Database(join(f.root, "app.db"));
    try {
      expect(check.pragma("user_version", { simple: true })).toBe(4);
    } finally {
      check.close();
    }
  });
  it("removes a project from daily use while retaining history and files and releasing its path", async () => {
    const f = await fixture();
    try {
      const project = await f.service.save(draft("A", f.repo));
      await writeFile(join(f.repo, "source.txt"), "developer-owned source");
      const task = {
        id: randomUUID(),
        projectId: project.id,
        projectName: "A",
        kind: "PREPARE_CONTEXT" as const,
        status: "FAILED" as const,
        attempt: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        error: null,
        contextSnapshotId: null,
      };
      f.store.saveTask(task);
      f.service.delete(project.id, project.revision);
      expect(f.service.list()).toEqual([]);
      expect(f.store.listTasks()).toEqual([]);
      expect(f.store.getTask(task.id)).toEqual(task);
      expect(() => f.service.get(project.id)).toThrow("项目不存在");
      await expect(
        f.service.save(
          { ...draft("stale", f.repo), id: project.id },
          project.revision,
        ),
      ).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
      expect(await readFile(join(f.repo, "source.txt"), "utf8")).toBe(
        "developer-owned source",
      );
      const replacement = await f.service.save(draft("B", f.repo));
      expect(replacement.id).not.toBe(project.id);
      f.store.close();
      const reopened = await DataStore.open(join(f.root, "app.db"));
      try {
        expect(reopened.listProjects().map((p) => p.id)).toEqual([
          replacement.id,
        ]);
        expect(reopened.getTask(task.id)).toEqual(task);
      } finally {
        reopened.close();
      }
    } finally {
      f.store.close();
    }
  });
  it("rejects stale deletion and every active task state without changing project bindings", async () => {
    const f = await fixture();
    try {
      const p = await f.service.save(draft("A", f.repo));
      expect(() => f.service.delete(p.id, p.revision + 1)).toThrow();
      const task = {
        id: randomUUID(),
        projectId: p.id,
        projectName: "A",
        kind: "PREPARE_CONTEXT" as const,
        status: "QUEUED" as const,
        attempt: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        error: null,
        contextSnapshotId: null,
      };
      for (const status of [
        "QUEUED",
        "PREPARING",
        "RUNNING",
        "VALIDATING",
        "CANCELLING",
      ] as const) {
        f.store.saveTask({ ...task, status });
        expect(() => f.service.delete(p.id, p.revision)).toThrow(
          "请先取消或等待项目任务结束",
        );
      }
      expect(f.service.get(p.id)).toEqual(p);
      await expect(f.service.save(draft("B", f.repo))).rejects.toMatchObject({
        code: "PATH_IN_USE",
      });
    } finally {
      f.store.close();
    }
  });
  it("persists independent projects after reopening the database", async () => {
    const f = await fixture();
    const repoB = join(f.root, "B");
    await mkdir(repoB);
    try {
      const a = await f.service.save(draft("A", f.repo));
      const b = await f.service.save(draft("B", repoB));
      expect(a.id).not.toBe(b.id);
      f.store.close();
      const reopened = await DataStore.open(join(f.root, "app.db"));
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
