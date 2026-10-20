import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { DataStore } from "./database";
import { ProjectService } from "../../core/src/projects/project-service";
import { TaskService } from "../../core/src/tasks/task-service";

it("updates code without reading documents, creating contexts, or requiring AI", async () => {
  const dir = await mkdtemp(join(tmpdir(), "code-update-task-")); const store = await DataStore.open(join(dir, "app.db"));
  const id = randomUUID();
  store.saveProject({ id, name: "P", revision: 1, enabled: true, aiProfileId: null, updatedAt: "now", documents: [{ id: "d", kind: "pdf", locator: "missing.pdf", required: true }], issueBindings: [], repositories: [{ id: "r", canonicalPath: dir, branch: "main", remoteName: "origin", role: "main", remoteUrlFingerprint: null }] });
  const update = vi.fn(async () => {});
  const unexpected = () => { throw new Error("code update must not prepare analysis"); };
  const tasks = new TaskService(store, new ProjectService(store), { update, continueUpdate: update, inspect: unexpected, assertReady: unexpected, synchronize: unexpected }, { configurationHash: unexpected, captureDocuments: unexpected, indexContext: unexpected, analyze: unexpected });
  try {
    const queued = await tasks.enqueue(id, "UPDATE_CODE");
    await expect.poll(() => tasks.get(queued.id).status).toBe("SUCCEEDED");
    expect(update).toHaveBeenCalledTimes(1);
    expect(store.latestContext(id)).toBeNull();
    expect(tasks.get(queued.id).contextSnapshotId).toBeNull();
  } finally { await tasks.shutdown(); store.close(); await rm(dir, { recursive: true, force: true }); }
});

it("backs up v5 before enabling persisted code-update task kinds", async () => {
  const dir = await mkdtemp(join(tmpdir(), "code-update-upgrade-")); const path = join(dir, "app.db");
  const store = await DataStore.open(path); store.setSetting("retained", "value"); store.close();
  const old = new Database(path); old.pragma("user_version = 5"); old.close();
  try {
    const upgraded = await DataStore.open(path);
    expect(upgraded.getSetting("retained")).toBe("value"); upgraded.close();
    expect((await readdir(dir)).some(p => p.includes("backup-v5"))).toBe(true);
    const db = new Database(path); expect(db.pragma("user_version", { simple: true })).toBe(7); db.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});
