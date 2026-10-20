import { afterEach, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DataStore } from "./database";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function legacy() {
  const root = await mkdtemp(join(tmpdir(), "platform-migration-"));
  roots.push(root);
  const path = join(root, "app.db");
  const db = new Database(path);
  db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, json TEXT NOT NULL);
    CREATE TABLE repository_paths (path_key TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id));
    CREATE TABLE tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), status TEXT NOT NULL, created_at TEXT NOT NULL, json TEXT NOT NULL);
    CREATE TABLE contexts (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), json TEXT NOT NULL);
    CREATE TABLE task_events (task_id TEXT NOT NULL REFERENCES tasks(id), sequence INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY(task_id, sequence));
    PRAGMA user_version=1;`);
  db.prepare("INSERT INTO projects VALUES (?, ?, ?)").run(
    "p",
    1,
    JSON.stringify({ id: "p", name: "legacy", revision: 1 }),
  );
  db.close();
  return { root, path };
}
it("backs up v4 before enabling the new issue snapshot contract and preserves existing settings", async () => {
  const root = await mkdtemp(join(tmpdir(), "platform-v4-migration-"));
  roots.push(root);
  const path = join(root, "app.db");
  let store = await DataStore.open(path);
  store.setSetting("existing", { value: "keep" });
  store.close();
  const old = new Database(path);
  old.pragma("user_version = 4");
  old.close();
  store = await DataStore.open(path);
  try {
    expect(store.getSetting("existing")).toEqual({ value: "keep" });
    expect((await readdir(root)).some(name => name.includes("backup-v4"))).toBe(true);
  } finally { store.close(); }
  const upgraded = new Database(path);
  try { expect(upgraded.pragma("user_version", { simple: true })).toBe(6); }
  finally { upgraded.close(); }
});
it("backs up v1 before migrating and preserves projects", async () => {
  const f = await legacy();
  const store = await DataStore.open(f.path);
  try {
    expect(store.getProject("p").name).toBe("legacy");
  } finally {
    store.close();
  }
  const backups = (await readdir(f.root)).filter((name) =>
    name.includes("backup-v1"),
  );
  expect(backups).toHaveLength(1);
  const backup = new Database(join(f.root, backups[0]));
  try {
    expect(backup.pragma("user_version", { simple: true })).toBe(1);
    expect(backup.prepare("SELECT count(*) AS n FROM projects").get()).toEqual({
      n: 1,
    });
  } finally {
    backup.close();
  }
  const upgraded = new Database(f.path);
  try {
    expect(upgraded.pragma("user_version", { simple: true })).toBe(6);
  } finally {
    upgraded.close();
  }
});
it("does not migrate when the backup cannot be created", async () => {
  const f = await legacy();
  const blocked = join(f.root, "not-a-directory");
  await writeFile(blocked, "keep");
  await expect(
    DataStore.open(f.path, { backupDirectory: blocked }),
  ).rejects.toThrow();
  const db = new Database(f.path);
  try {
    expect(db.pragma("user_version", { simple: true })).toBe(1);
  } finally {
    db.close();
  }
});
it("rolls back the context and successful task when report ownership validation fails", async () => {
  const f = await legacy();
  const store = await DataStore.open(f.path);
  try {
    const task = {
      id: "task",
      projectId: "p",
      projectName: "P",
      kind: "CHECK_REQUIREMENTS" as const,
      attemptId: "a",
      status: "RUNNING" as const,
      attempt: 1,
      createdAt: "now",
      updatedAt: "now",
      contextSnapshotId: null,
      error: null,
    };
    store.saveTask(task);
    const context = {
      id: "context",
      projectId: "p",
      configRevision: 1,
      repositories: [],
      documents: [],
      createdAt: "now",
      limitations: [],
    };
    expect(() =>
      store.completeAnalysis(task, context, {
        schemaVersion: 1,
        id: "report",
        projectId: "wrong",
        taskId: "task",
        attemptId: "a",
        contextSnapshotId: "context",
        requirementSetId: "set",
        inputSnapshotIds: [],
        executorVersion: "test",
        executorConfiguration: {
          profileId: "test",
          kind: "api",
          name: "test",
          configuredModel: "test",
          location: "https://example.invalid",
          configurationHash: "0".repeat(64),
        },
        templateVersion: "test",
        createdAt: "now",
        findings: [],
        evidenceRefs: [],
        limitations: [],
        sourceGaps: [],
        parseWarnings: [],
        usage: null,
      }),
    ).toThrow();
    expect(store.getTask("task").status).toBe("RUNNING");
    expect(store.latestContext("p")).toBeNull();
    expect(store.listReports("p")).toEqual([]);
  } finally {
    store.close();
  }
});
