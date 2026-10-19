import type Database from "better-sqlite3";
import { mkdir } from "node:fs/promises";
import { dirname, join, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { AppError } from "../../contracts/src/error";
export async function migrateDatabase(
  db: Database.Database,
  path: string,
  backupDirectory = dirname(path),
): Promise<void> {
  const version = db.pragma("user_version", { simple: true }) as number;
  if (version > 2)
    throw new AppError("DATABASE_NEWER", "数据库版本比当前应用新");
  if (version === 1) {
    await mkdir(backupDirectory, { recursive: true });
    await db.backup(
      join(backupDirectory, `${basename(path)}.backup-v1-${randomUUID()}.db`),
    );
  }
  if (version === 2) return;
  db.transaction(() => {
    if (version === 0)
      db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,json TEXT NOT NULL);
      CREATE TABLE repository_paths(path_key TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id));
      CREATE TABLE tasks(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),status TEXT NOT NULL,created_at TEXT NOT NULL,json TEXT NOT NULL);
      CREATE TABLE contexts(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),json TEXT NOT NULL);
      CREATE TABLE task_events(task_id TEXT NOT NULL REFERENCES tasks(id),sequence INTEGER NOT NULL,json TEXT NOT NULL,PRIMARY KEY(task_id,sequence));
      CREATE INDEX tasks_by_project ON tasks(project_id,created_at);`);
    db.exec(`CREATE TABLE documents(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),json TEXT NOT NULL);
      CREATE TABLE requirement_sets(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),context_id TEXT NOT NULL REFERENCES contexts(id),revision INTEGER NOT NULL,json TEXT NOT NULL);
      CREATE TABLE reports(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id),json TEXT NOT NULL);
      CREATE TABLE settings(key TEXT PRIMARY KEY,json TEXT NOT NULL);
      CREATE TABLE search_chunks(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,context_id TEXT NOT NULL,json TEXT NOT NULL,text TEXT NOT NULL);
      CREATE VIRTUAL TABLE search_fts USING fts5(id UNINDEXED,text,tokenize='trigram');
      UPDATE tasks SET json=json_set(json,'$.attemptId',id) WHERE json_extract(json,'$.attemptId') IS NULL;
      PRAGMA user_version=2;`);
  })();
}
