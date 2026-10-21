import type Database from "better-sqlite3";
import { mkdir } from "node:fs/promises";
import { dirname, join, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { AppError } from "../../contracts/src/error";
async function migrateLegacyDatabase(
  db: Database.Database,
  path: string,
  backupDirectory = dirname(path),
): Promise<void> {
  const version = db.pragma("user_version", { simple: true }) as number;
  if (version > 10)
    throw new AppError("DATABASE_NEWER", "数据库版本比当前应用新");
  if (version >= 1 && version < 10) {
    await mkdir(backupDirectory, { recursive: true });
    await db.backup(
      join(
        backupDirectory,
        `${basename(path)}.backup-v${version}-${randomUUID()}.db`,
      ),
    );
  }
  if (version === 10) return;
  // v10 adds standalone log tasks, removed task history, and explicit no-AI selections.
  if(version === 9){db.transaction(()=>db.pragma("user_version=10"))();return;}
  const materialSql = `CREATE TABLE IF NOT EXISTS issue_materials(id TEXT PRIMARY KEY,scope_key TEXT NOT NULL,generation INTEGER NOT NULL,status TEXT NOT NULL,json TEXT NOT NULL,UNIQUE(scope_key,generation)); CREATE INDEX IF NOT EXISTS material_scope ON issue_materials(scope_key,generation); PRAGMA user_version=10;`;
  if(version === 8) {db.transaction(()=>{db.exec(materialSql);})();return;}
  db.transaction(() => {
    if (version === 0)
      db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,json TEXT NOT NULL);
      CREATE TABLE repository_paths(path_key TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id));
      CREATE TABLE tasks(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),status TEXT NOT NULL,created_at TEXT NOT NULL,json TEXT NOT NULL);
      CREATE TABLE contexts(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),json TEXT NOT NULL);
      CREATE TABLE task_events(task_id TEXT NOT NULL REFERENCES tasks(id),sequence INTEGER NOT NULL,json TEXT NOT NULL,PRIMARY KEY(task_id,sequence));
      CREATE INDEX tasks_by_project ON tasks(project_id,created_at);`);
    if (version < 2)
      db.exec(`CREATE TABLE documents(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),json TEXT NOT NULL);
      CREATE TABLE requirement_sets(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),context_id TEXT NOT NULL REFERENCES contexts(id),revision INTEGER NOT NULL,json TEXT NOT NULL);
      CREATE TABLE reports(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id),json TEXT NOT NULL);
      CREATE TABLE settings(key TEXT PRIMARY KEY,json TEXT NOT NULL);
      CREATE TABLE search_chunks(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,context_id TEXT NOT NULL,json TEXT NOT NULL,text TEXT NOT NULL);
      CREATE VIRTUAL TABLE search_fts USING fts5(id UNINDEXED,text,tokenize='trigram');
      UPDATE tasks SET json=json_set(json,'$.attemptId',id) WHERE json_extract(json,'$.attemptId') IS NULL;
      PRAGMA user_version=2;`);
    if (version < 3)
      db.exec(`CREATE TABLE issue_snapshots(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),binding_id TEXT NOT NULL,remote_id TEXT NOT NULL,json TEXT NOT NULL);
      CREATE TABLE issue_batches(project_id TEXT NOT NULL REFERENCES projects(id),binding_id TEXT NOT NULL,scope_hash TEXT NOT NULL,json TEXT NOT NULL,PRIMARY KEY(project_id,binding_id));
      CREATE TABLE bug_reports(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id),json TEXT NOT NULL);
      PRAGMA user_version=3;`);
    // Removal is part of the persisted project JSON contract. Older clients must
    // reject this version instead of displaying removed projects again.
    // v6 adds code-update task kinds older clients must not retry as analysis.
    // v7 stores shared document references and inherited default AI choices.
    const existingResources = db.prepare("SELECT json FROM settings WHERE key='document-resources'").get() as { json: string } | undefined;
    const resources: { id: string; name: string; kind: string; locator: string; required: boolean; revision: number }[] = existingResources ? JSON.parse(existingResources.json) : [];
    for (const row of db.prepare("SELECT id,json FROM projects").all() as { id: string; json: string }[]) {
      const project = JSON.parse(row.json);
      if (project.documentRefs || !Array.isArray(project.documents)) continue;
      const refs = project.documents.map((doc: { id: string; kind: string; locator: string; required: boolean }) => {
        const sameId = resources.find(r => r.id === doc.id);
        const id = sameId && (sameId.locator !== doc.locator || sameId.kind !== doc.kind) ? randomUUID() : doc.id;
        if (!resources.some(r => r.id === id)) resources.push({ ...doc, id, name: doc.locator.split(/[\\/]/).at(-1) || doc.locator, revision: 1 });
        return { id, required: doc.required };
      });
      db.prepare("UPDATE projects SET json=? WHERE id=?").run(JSON.stringify({ ...project, documents: [], documentRefs: refs }), row.id);
    }
    db.prepare("INSERT INTO settings(key,json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json").run("document-resources", JSON.stringify(resources));
    const profiles = db.prepare("SELECT json FROM settings WHERE key='profiles'").get() as { json: string } | undefined;
    const first = profiles ? JSON.parse(profiles.json)[0] : undefined;
    if (first) db.prepare("INSERT OR IGNORE INTO settings(key,json) VALUES(?,?)").run("default-ai-profile", JSON.stringify(first.id));
    // v8 separates fixed Jira project connections from the singleton Trinity account.
    const connectionRow=db.prepare("SELECT json FROM settings WHERE key='issue-connections'").get() as {json:string}|undefined;
    {
      const connections=(connectionRow ? JSON.parse(connectionRow.json) : []) as import("../../contracts/src/issues").IssueConnection[];
      const account=connections.filter(c=>c.kind==="trinity").at(-1);
      const projects=db.prepare("SELECT id,json FROM projects").all() as {id:string;json:string}[];
      const migrated=connections.filter(c=>c.kind!=="trinity").map(c=>{
        if(c.jiraProject)return c;
        const refs=projects.filter(p=>!JSON.parse(p.json).deletedAt).flatMap(p=>JSON.parse(p.json).issueBindings??[]).filter((b:{connectionId?:string})=>b.connectionId===c.id);
        const distinct=[...new Set(refs.map((b:{projectKey:string;owner:string;issueTypeIds?:string[]})=>JSON.stringify({key:b.projectKey,owner:b.owner,issueTypeIds:b.issueTypeIds})))];
        if(distinct.length!==1)return c;
        const selected=JSON.parse(distinct[0] as string);
        return selected.issueTypeIds?.length?{...c,jiraProject:{...selected,name:selected.key}}:c;
      });
      db.prepare("UPDATE settings SET json=? WHERE key='issue-connections'").run(JSON.stringify([...migrated,...(account?[account]:[])]));
      for(const row of projects){
        const project=JSON.parse(row.json);
        const mappings=project.trinityProjects??(project.issueBindings??[]).filter((b:{platform:string;connectionId?:string;scopeMode?:string})=>b.platform==="trinity"&&b.connectionId===account?.id&&b.scopeMode!=="account").map((b:{instanceUrl:string;projectKey:string})=>({instanceUrl:b.instanceUrl,projectId:b.projectKey}));
        const updated={...project,trinityProjects:mappings,issueBindings:(project.issueBindings??[]).filter((b:{platform:string})=>b.platform!=="trinity")};
        db.prepare("UPDATE projects SET json=? WHERE id=?").run(JSON.stringify(updated),row.id);
      }
    }
    db.exec(materialSql);
  })();
}

async function migrateLibraryDatabase(db:Database.Database,path:string,backupDirectory=dirname(path)):Promise<void>{
 const version=db.pragma("user_version",{simple:true}) as number;
 if(version>11)throw new AppError("DATABASE_NEWER","数据库版本比当前应用新");
 if(version===11)return;
 if(version===10){await mkdir(backupDirectory,{recursive:true});await db.backup(join(backupDirectory,`${basename(path)}.backup-v10-${randomUUID()}.db`));}
 if(version<10)await migrateLegacyDatabase(db,path,backupDirectory);
 db.transaction(()=>{
 db.exec(`CREATE TABLE library_categories(id TEXT PRIMARY KEY,json TEXT NOT NULL); CREATE TABLE library_resources(id TEXT PRIMARY KEY,json TEXT NOT NULL); CREATE TABLE project_resource_links(project_id TEXT NOT NULL REFERENCES projects(id),resource_id TEXT NOT NULL REFERENCES library_resources(id),role TEXT NOT NULL,required INTEGER NOT NULL,PRIMARY KEY(project_id,resource_id));`);
 const row=db.prepare("SELECT json FROM settings WHERE key='document-resources'").get() as {json:string}|undefined;
 const resources=row?JSON.parse(row.json):[];
 const insert=db.prepare("INSERT INTO library_resources VALUES(?,?)");
 for(const r of resources)insert.run(r.id,JSON.stringify({...r,categoryId:null,purpose:"requirement",notes:"",contentRevision:1}));
 for(const row of db.prepare("SELECT id,json FROM projects").all() as {id:string;json:string}[]){
 const p=JSON.parse(row.json);for(const ref of p.documentRefs??[])db.prepare("INSERT INTO project_resource_links VALUES(?,?,?,?)").run(row.id,ref.id,"requirement",Number(ref.required));delete p.documentRefs;p.documents=[];db.prepare("UPDATE projects SET json=? WHERE id=?").run(JSON.stringify(p),row.id);}
 db.prepare("DELETE FROM settings WHERE key='document-resources'").run();db.pragma("user_version=11");
 })();
}

export async function migrateDatabase(db:Database.Database,path:string,backupDirectory=dirname(path)):Promise<void>{
 const version=db.pragma("user_version",{simple:true}) as number;if(version>12)throw new AppError("DATABASE_NEWER","数据库版本比当前应用新");if(version===12)return;
 if(version===11){await mkdir(backupDirectory,{recursive:true});await db.backup(join(backupDirectory,`${basename(path)}.backup-v11-${randomUUID()}.db`));}
 else await migrateLibraryDatabase(db,path,backupDirectory);
 db.transaction(()=>{db.exec(`CREATE TABLE requirement_reviews(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),fingerprint TEXT NOT NULL,json TEXT NOT NULL,UNIQUE(project_id,fingerprint));CREATE TABLE requirement_review_events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,project_id TEXT NOT NULL,item_id TEXT NOT NULL REFERENCES requirement_reviews(id),action TEXT NOT NULL,created_at TEXT NOT NULL);CREATE TABLE requirement_review_reports(report_id TEXT PRIMARY KEY);PRAGMA user_version=12;`);})();
}
