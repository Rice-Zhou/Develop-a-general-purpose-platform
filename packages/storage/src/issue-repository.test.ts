import { expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DataStore } from "./database";
import type { IssueSnapshot } from "../../contracts/src/issues";
it("upgrades v2 with backup and atomically stores immutable scoped issue batches", async () => {
  const root = await mkdtemp(join(tmpdir(), "issue-store-"));
  const path = join(root, "db.sqlite");
  let store = await DataStore.open(path);
  store.close();
  const db = new Database(path);
  db.exec(
    "DROP TABLE IF EXISTS issue_snapshots; DROP TABLE IF EXISTS issue_batches; DROP TABLE IF EXISTS bug_reports; PRAGMA user_version=2",
  );
  db.close();
  store = await DataStore.open(path);
  try {
    expect((await readdir(root)).some((n) => n.includes("backup-v2"))).toBe(
      true,
    );
    store.saveProject({
      id: "p",
      name: "A",
      enabled: true,
      revision: 1,
      repositories: [],
      documents: [],
      issueBindings: [],
      aiProfileId: null,
      updatedAt: "now",
    });
    const snapshot: IssueSnapshot = {
      schemaVersion: 1,
      id: randomUUID(),
      projectId: "p",
      bindingId: "b",
      connectionId: "c",
      scopeHash: "s",
      contentHash: "h",
      fetchedAt: "now",
      remoteId: "1",
      key: "A-1",
      instanceUrl: "https://jira.example",
      remoteProjectId: "A",
      ownerId: "alice",
      typeId: "1",
      title: "Bug",
      description: "original",
      status: "Open",
      updatedAt: "now",
      versions: [],
      comments: [],
      attachments: [],
      warnings: [],
    };
    store.issues.replaceBatch("p", "b", "s", [snapshot]);
    expect(store.issues.batch("p", "b", "s")[0].description).toBe("original");
    expect(() => store.issues.get("another", snapshot.id)).toThrow();
    expect(() =>
      store.issues.replaceBatch("p", "b", "s", [
        { ...snapshot, id: randomUUID(), projectId: "other" },
      ]),
    ).toThrow();
    expect(store.issues.batch("p", "b", "s")).toHaveLength(1);
    store.issues.replaceBatch("p", "b", "s", []);
    expect(store.issues.batch("p", "b", "s")).toHaveLength(0);
    expect(store.issues.get("p", snapshot.id).description).toBe("original");
    const task = {
      id: "t",
      projectId: "p",
      projectName: "P",
      kind: "ANALYZE_BUG" as const,
      status: "RUNNING" as const,
      attempt: 1,
      createdAt: "now",
      updatedAt: "now",
      error: null,
      contextSnapshotId: null,
    };
    store.saveTask(task);
    const missing = randomUUID();
    const context = {
      id: "ctx",
      projectId: "p",
      configRevision: 1,
      createdAt: "now",
      repositories: [],
      documents: [],
      limitations: [],
      issueSnapshotId: missing,
    };
    expect(() =>
      store.completeBug(task, context, {
        schemaVersion: 1,
        id: randomUUID(),
        projectId: "p",
        taskId: "t",
        attemptId: "t",
        contextSnapshotId: "ctx",
        issueSnapshotId: missing,
        createdAt: "now",
        executorVersion: "test",
        executorConfiguration: {
          profileId: "m",
          kind: "api",
          name: "m",
          configuredModel: "fixture",
          location: "http://127.0.0.1",
          configurationHash: "0".repeat(64),
        },
        templateVersion: "bugs-1",
        reproduction: [],
        facts: [],
        hypotheses: [],
        missingInformation: ["logs"],
        evidenceRefs: [],
        checkedScope: [],
        limitations: [],
        verification: "STATIC_PRELIMINARY",
        usage: null,
      }),
    ).toThrow();
    expect(store.getTask("t").status).toBe("RUNNING");
    expect(() => store.getContext("ctx")).toThrow();
    expect(store.issues.reports("p")).toHaveLength(0);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
