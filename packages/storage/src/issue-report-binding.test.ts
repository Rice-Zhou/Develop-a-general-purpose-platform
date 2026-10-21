import { afterEach, expect, it } from "vitest";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { IssueRepository } from "./issue-repository";
import type { IssueSnapshot, BugReport } from "../../contracts/src/issues";
const db = new Database(":memory:");
db.exec(
  "CREATE TABLE issue_snapshots(id TEXT PRIMARY KEY,project_id TEXT,binding_id TEXT,remote_id TEXT,json TEXT);CREATE TABLE bug_reports(id TEXT PRIMARY KEY,project_id TEXT,task_id TEXT,json TEXT)",
);
const repo = new IssueRepository(db);
afterEach(() => db.exec("DELETE FROM bug_reports;DELETE FROM issue_snapshots"));
function issue(
  projectId = "p",
  connectionId = "c",
  remoteId = "1",
): IssueSnapshot {
  return {
    schemaVersion: 1,
    id: randomUUID(),
    projectId,
    bindingId: "b",
    connectionId,
    scopeHash: "scope",
    contentHash: "hash",
    fetchedAt: "now",
    remoteId,
    key: "SAME-1",
    instanceUrl: "https://example.test",
    remoteProjectId: "A",
    ownerId: "alice",
    typeId: "bug",
    title: "same title",
    description: "",
    status: "Open",
    updatedAt: "now",
    versions: [],
    comments: [],
    attachments: [],
    warnings: [],
  };
}
function save(snapshot: IssueSnapshot, taskId = randomUUID()): BugReport {
  repo.save(snapshot);
  const r: BugReport = {
    schemaVersion: 2,
    id: randomUUID(),
    projectId: snapshot.projectId,
    taskId,
    attemptId: taskId,
    contextSnapshotId: "context",
    issueSnapshotId: snapshot.id,
    createdAt: new Date().toISOString(),
    executorVersion: "test",
    executorConfiguration: {
      profileId: "model",
      kind: "api",
      name: "model",
      configuredModel: "fixture",
      location: "local",
      configurationHash: "0".repeat(64),
    },
    templateVersion: "bugs-2-current-code-logs",
    reproduction: [],
    facts: [],
    hypotheses: [],
    missingInformation: ["fixture"],
    evidenceRefs: [],
    checkedScope: [],
    limitations: [],
    verification: "STATIC_PRELIMINARY",
    usage: null,
  };
  repo.saveReport(r);
  return r;
}
it("binds a refreshed issue to the report's prepared snapshot rather than the original task input", () => {
  const original = issue();
  repo.save(original);
  const prepared = { ...original, id: randomUUID() };
  const r = save(prepared);
  const refreshed = { ...original, id: randomUUID() };
  repo.save(refreshed);
  expect(
    repo.reportSummariesForIssues([
      {
        analysisProjectId: "p",
        connectionId: refreshed.connectionId,
        remoteId: refreshed.remoteId,
      },
    ]),
  ).toEqual([
    {
      analysisProjectId: "p",
      connectionId: "c",
      remoteId: "1",
      reportId: r.id,
      taskId: r.taskId,
      createdAt: r.createdAt,
    },
  ]);
  expect(repo.reportForTask("p", r.taskId).id).toBe(r.id);
});
it("isolates identical keys across projects, connections and remote IDs", () => {
  save(issue());
  save(issue("other"));
  save(issue("p", "other"));
  save(issue("p", "c", "2"));
  expect(
    repo.reportSummariesForIssues([
      { analysisProjectId: "p", connectionId: "c", remoteId: "1" },
    ]),
  ).toHaveLength(1);
  expect(repo.reportSummariesForIssues([])).toEqual([]);
  expect(() => repo.reportForTask("other", "missing")).toThrow();
});
it("finds old reports without requiring a task row or active model", () => {
  const r = save(issue());
  expect(repo.reportForTask("p", r.taskId)).toEqual(r);
  expect(() => repo.reportForTask("other", r.taskId)).toThrow();
});
