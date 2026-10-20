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
  try { expect(upgraded.pragma("user_version", { simple: true })).toBe(8); }
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
    expect(upgraded.pragma("user_version", { simple: true })).toBe(8);
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

it("migrates actual v6 inline documents and AI choices to shared resources without losing overrides", async () => {
  const f = await legacy();
  let store = await DataStore.open(f.path);
  store.close();
  const old = new Database(f.path);
  const profiles = [{ id: "first" }, { id: "override" }];
  old.prepare("DELETE FROM settings WHERE key IN ('document-resources','default-ai-profile')").run();
  old.prepare("INSERT INTO settings(key,json) VALUES('profiles',?)").run(JSON.stringify(profiles));
  const base = { id: "p", revision: 1, name: "A", enabled: true, repositories: [], issueBindings: [], updatedAt: "before", aiProfileId: null, documents: [{ id: "d", kind: "docx", locator: "D:/req.docx", required: true }] };
  old.prepare("UPDATE projects SET json=? WHERE id='p'").run(JSON.stringify(base));
  old.prepare("INSERT INTO projects VALUES(?,?,?)").run("other", 1, JSON.stringify({ ...base, id: "other", aiProfileId: "override", documents: [{ ...base.documents[0], locator: "D:/different.docx", required: false }] }));
  old.pragma("user_version=6"); old.close();
  store = await DataStore.open(f.path);
  try {
    expect(store.getProject("p")).toMatchObject({ documents: base.documents, aiProfileId: "first", usesDefaultAI: true });
    expect(store.getProject("other").aiProfileId).toBe("override");
    expect(store.getProject("other").usesDefaultAI).not.toBe(true);
    expect(store.documentResources()).toHaveLength(2);
    expect(store.getProject("other").documents[0]).toMatchObject({ locator: "D:/different.docx", required: false });
    expect(store.getProject("other").documents[0].id).not.toBe("d");
    expect((await readdir(f.root)).some(name => name.includes("backup-v6"))).toBe(true);
  } finally { store.close(); }
});

it("backs up v7 and preserves explicit remote project mappings while moving Trinity to one account",async()=>{
 const f=await legacy();let store=await DataStore.open(f.path);store.close();
 const db=new Database(f.path);
 const jira={id:"j",kind:"jira-http",platform:"jira-dc",name:"Jira",baseUrl:"https://jira.example",username:"alice",credentialRef:null,bypassProxy:true};
 const account={id:"t",kind:"trinity",platform:"trinity",name:"Trinity",baseUrl:"https://trinity.example/trinity",username:"login",credentialRef:null,bypassProxy:true};
 const project={id:"p",revision:1,name:"Code",enabled:true,documents:[],documentRefs:[],repositories:[],aiProfileId:null,updatedAt:"now",issueBindings:[{id:"j1",connectionId:"j",platform:"jira-dc",instanceUrl:jira.baseUrl,projectKey:"A",owner:"alice",issueTypeIds:["1"]},{id:"t1",connectionId:"t",platform:"trinity",instanceUrl:account.baseUrl,projectKey:"T",owner:"old-manual-owner",issueTypeIds:["BUG"]}]};
 db.prepare("INSERT INTO settings(key,json) VALUES('issue-connections',?)").run(JSON.stringify([jira,account]));
 db.prepare("UPDATE projects SET json=? WHERE id='p'").run(JSON.stringify(project));db.pragma("user_version=7");db.close();
 store=await DataStore.open(f.path);
 try{
  expect(store.getProject("p").trinityProjects).toEqual([{instanceUrl:account.baseUrl,projectId:"T"}]);
  expect(store.getProject("p").issueBindings.find(b=>b.platform==="trinity")).toMatchObject({scopeMode:"account",projectKey:"*",owner:"待重新登录"});
  expect(store.getSetting<[{jiraProject:unknown}]>("issue-connections")![0].jiraProject).toMatchObject({key:"A",owner:"alice",issueTypeIds:["1"]});
  expect((await readdir(f.root)).some(name=>name.includes("backup-v7"))).toBe(true);
 }finally{store.close();}
});
