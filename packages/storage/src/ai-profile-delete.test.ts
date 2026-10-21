import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { DataStore } from "./database";
import { ProjectService } from "../../core/src/projects/project-service";
import { TaskService, type TaskRuntime } from "../../core/src/tasks/task-service";
import { GitRepositoryAdapter } from "../../adapters/src/git/repository";
import type { Project, Task } from "../../contracts/src/models";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "ai-delete-"));
  const path = join(root, "test.db");
  const store = await DataStore.open(path);
  cleanup.push(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  store.setSetting("profiles", ids.map(id => ({ id, name: id })));
  store.setDefaultAIProfile(ids[0]);
  function project(aiProfileId: string | null, deletedAt?: string) {
    const p: Project = { id: randomUUID(), name: "测试项目", enabled: true, revision: 1, repositories: [], documents: [], issueBindings: [], aiProfileId, updatedAt: "before", ...(deletedAt ? { deletedAt } : {}) };
    store.saveProject(p);
    return p;
  }
  return { store, root, path, ids, project };
}
it("atomically replaces default and explicit references including deleted projects and preserves inheritance", async () => {
  const f = await fixture();
  const inherited = f.project(null), explicit = f.project(f.ids[0]), other = f.project(f.ids[2]);
  const deleted = f.project(f.ids[0], "deleted");
  f.store.deleteAIProfile(f.ids[0], f.ids[1]);
  expect(f.store.getDefaultAIProfile()).toBe(f.ids[1]);
  expect(f.store.getProject(inherited.id)).toMatchObject({ aiProfileId: f.ids[1], usesDefaultAI: true, revision: 2 });
  expect(f.store.getProject(explicit.id)).toMatchObject({ aiProfileId: f.ids[1], revision: 2 });
  expect(f.store.getProject(other.id).revision).toBe(1);
  const db = new Database(f.path);
  try { expect(JSON.parse((db.prepare("SELECT json FROM projects WHERE id=?").get(deleted.id) as { json: string }).json)).toMatchObject({ aiProfileId: f.ids[1], deletedAt: "deleted" }); }
  finally { db.close(); }
  expect(f.store.getSetting<{ id: string }[]>("profiles")?.map(p => p.id)).toEqual(f.ids.slice(1));
});
it("explicit unlink stays unconfigured instead of charging another default even after a project save", async () => {
  const f = await fixture(); const p = f.project(f.ids[1]);
  f.store.deleteAIProfile(f.ids[1], null);
  const detached = f.store.getProject(p.id);
  expect(detached.aiProfileId).toBeNull();
  f.store.saveProject({ ...detached, revision: detached.revision + 1 }, detached.revision);
  f.store.setDefaultAIProfile(f.ids[2]);
  expect(f.store.getProject(p.id).aiProfileId).toBeNull();
  expect(f.store.getDefaultAIProfile()).toBe(f.ids[2]);
});
it("clears a deleted default without silently selecting a remaining profile", async () => {
  const f = await fixture(); const p = f.project(null);
  f.store.deleteAIProfile(f.ids[0], null);
  expect(f.store.getDefaultAIProfile()).toBeNull();
  expect(f.store.getProject(p.id).aiProfileId).toBeNull();
  f.store.setDefaultAIProfile(f.ids[1]);
  expect(f.store.getProject(p.id).aiProfileId).toBeNull();
});
it("rolls back project and default changes if the profile deletion cannot be persisted", async () => {
  const f = await fixture(); const p = f.project(f.ids[0]);
  const db = new Database(f.path);
  try { db.exec("CREATE TRIGGER reject_profile_delete BEFORE UPDATE ON settings WHEN NEW.key='profiles' BEGIN SELECT RAISE(ABORT, 'profile write rejected'); END"); }
  finally { db.close(); }
  expect(() => f.store.deleteAIProfile(f.ids[0], f.ids[1])).toThrow("profile write rejected");
  expect(f.store.getDefaultAIProfile()).toBe(f.ids[0]);
  expect(f.store.getProject(p.id)).toMatchObject({ aiProfileId: f.ids[0], revision: 1 });
  expect(f.store.getSetting<unknown[]>("profiles")).toHaveLength(3);
});
it.each(["QUEUED", "PREPARING", "RUNNING", "VALIDATING", "CANCELLING"] as const)("protects inherited connections while a task is %s without partial mutation", async status => {
  const f = await fixture(); const p = f.project(null);
  const task: Task = { id: randomUUID(), projectId: p.id, projectName: p.name, kind: "ANALYZE_BUG", status, attempt: 1, createdAt: "now", updatedAt: "now", error: null, contextSnapshotId: null };
  f.store.saveTask(task);
  expect(() => f.store.deleteAIProfile(f.ids[0], f.ids[1])).toThrow(/先取消/);
  expect(f.store.getDefaultAIProfile()).toBe(f.ids[0]);
  expect(f.store.getSetting<unknown[]>("profiles")).toHaveLength(3);
  expect(f.store.getProject(p.id).revision).toBe(1);
});
it.each(["DOWNLOAD_ISSUE_LOGS", "PREPARE_CONTEXT", "UPDATE_CODE", "CONTINUE_CODE_UPDATE"] as const)("allows AI deletion while the independent %s task remains active and cancellable", async kind => {
  const f = await fixture(); const p = f.project(null);
  const task: Task = { id: randomUUID(), projectId: p.id, projectName: p.name, kind, status: "RUNNING", attempt: 1, createdAt: "now", updatedAt: "now", error: null, contextSnapshotId: null };
  f.store.saveTask(task);
  f.store.deleteAIProfile(f.ids[0], null);
  expect(f.store.getProject(p.id).aiProfileId).toBeNull();
  expect(f.store.getTask(task.id)).toEqual(task);
  f.store.saveTask({ ...task, status: "CANCELLING" });
  expect(f.store.getTask(task.id).status).toBe("CANCELLING");
});
it.each(["ANALYZE_BUG", "EXTRACT_REQUIREMENTS", "CHECK_REQUIREMENTS", "RESOLVE_CODE_CONFLICTS", "UNKNOWN_FUTURE_KIND", undefined])("protects the connection for AI or unknown task kind %s", async kind => {
  const f = await fixture(); const p = f.project(f.ids[0]);
  f.store.saveTask({ id: randomUUID(), projectId: p.id, projectName: p.name, kind, status: "RUNNING", attempt: 1, createdAt: "now", updatedAt: "now", error: null, contextSnapshotId: null } as Task);
  expect(() => f.store.deleteAIProfile(f.ids[0], null)).toThrow(/先取消/);
});
it("keeps independent log cancellation available through TaskService after AI deletion", async () => {
  const f = await fixture(); const p = f.project(null);
  const runtime = { cancelIssueLogTask: async (id: string) => {
    const current = f.store.getTask(id);
    expect(current.status).toBe("CANCELLING");
    f.store.saveTask({ ...current, status: "CANCELLED" });
  } } as TaskRuntime;
  const tasks = new TaskService(f.store, new ProjectService(f.store), new GitRepositoryAdapter(), runtime);
  try {
    const task: Task = { id: randomUUID(), projectId: p.id, projectName: p.name, kind: "DOWNLOAD_ISSUE_LOGS", status: "RUNNING", attempt: 1, createdAt: "now", updatedAt: "now", error: null, contextSnapshotId: null };
    f.store.saveTask(task);
    f.store.deleteAIProfile(f.ids[0], null);
    expect((await tasks.cancel(task.id)).status).toBe("CANCELLED");
    expect(f.store.getProject(p.id).aiProfileId).toBeNull();
  } finally { await tasks.shutdown(); }
});
it("rejects nonexistent or self replacement without changing any configuration", async () => {
  const f = await fixture();
  for (const replacement of [f.ids[0], randomUUID()]) expect(() => f.store.deleteAIProfile(f.ids[0], replacement)).toThrow(/其他有效/);
  expect(f.store.getDefaultAIProfile()).toBe(f.ids[0]);
  expect(f.store.getSetting<unknown[]>("profiles")).toHaveLength(3);
});
it("allows explicitly detached projects to restore default inheritance through project links", async () => {
  const f = await fixture(); const p = f.project(f.ids[1]);
  f.store.deleteAIProfile(f.ids[1], null);
  const detached = f.store.getProject(p.id);
  const service = new ProjectService(f.store);
  expect(service.saveLinks({ projectId: p.id, expectedRevision: detached.revision, documents: [], issueBindings: [], aiProfileId: null, usesDefaultAI: true })).toMatchObject({ aiProfileId: f.ids[0], usesDefaultAI: true });
});
it("preserves an explicit unlink when saving project details without changing AI configuration", async () => {
  const f = await fixture(); const p = f.project(f.ids[1]);
  f.store.deleteAIProfile(f.ids[1], null);
  const detached = f.store.getProject(p.id);
  const saved = await new ProjectService(f.store).save({ id: p.id, name: "更名项目", enabled: true, documents: [], issueBindings: [], repositories: [{ path: f.root, branch: "main", remoteName: "origin", role: "主仓库" }], aiProfileId: null }, detached.revision);
  expect(saved.aiProfileId).toBeNull();
  expect(saved.usesDefaultAI).toBe(false);
});
