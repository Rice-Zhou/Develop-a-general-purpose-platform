import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { migrateDatabase } from "./migrations";
import { AnalysisRepository } from "./analysis-repository";
import { AppError } from "../../contracts/src/error";
import type {
  ContextSnapshot,
  Project,
  Task,
  TaskEvent,
} from "../../contracts/src/models";
import { ACTIVE_TASK_STATUSES } from "../../contracts/src/models";

interface JsonRow {
  json: string;
}
export class DataStore extends AnalysisRepository {
  private constructor(
    readonly path: string,
    db: Database.Database,
  ) {
    super(db);
  }
  static async open(
    path: string,
    options: { backupDirectory?: string } = {},
  ): Promise<DataStore> {
    mkdirSync(dirname(path), { recursive: true });
    const db = new Database(path);
    try {
      db.pragma("journal_mode = WAL");
      db.pragma("foreign_keys = ON");
      db.pragma("busy_timeout = 5000");
      await migrateDatabase(db, path, options.backupDirectory);
      return new DataStore(path, db);
    } catch (error) {
      db.close();
      throw error;
    }
  }
  close(): void {
    if (this.db.open) this.db.close();
  }
  listProjects(): Project[] {
    return (
      this.db
        .prepare(
          "SELECT json FROM projects WHERE json_extract(json,'$.deletedAt') IS NULL ORDER BY rowid",
        )
        .all() as JsonRow[]
    ).map((row) => JSON.parse(row.json) as Project);
  }
  getProject(id: string): Project {
    const row = this.db
      .prepare(
        "SELECT json FROM projects WHERE id = ? AND json_extract(json,'$.deletedAt') IS NULL",
      )
      .get(id) as JsonRow | undefined;
    if (!row) throw new AppError("PROJECT_NOT_FOUND", "项目不存在");
    return JSON.parse(row.json) as Project;
  }
  saveProject(project: Project, expectedRevision?: number): void {
    this.db.transaction(() => {
      const existing = this.db
        .prepare(
          "SELECT revision,json_extract(json,'$.deletedAt') AS deletedAt FROM projects WHERE id = ?",
        )
        .get(project.id) as
        | { revision: number; deletedAt: string | null }
        | undefined;
      if (existing?.deletedAt)
        throw new AppError("PROJECT_NOT_FOUND", "项目不存在");
      if (existing && existing.revision !== expectedRevision)
        throw new AppError(
          "REVISION_CONFLICT",
          "配置已被更新，请重新打开项目后编辑",
        );
      if (!existing && expectedRevision !== undefined)
        throw new AppError("REVISION_CONFLICT", "项目版本不存在");
      const keys = project.repositories.map((repo) =>
        process.platform === "win32"
          ? repo.canonicalPath.toLowerCase()
          : repo.canonicalPath,
      );
      if (new Set(keys).size !== keys.length)
        throw new AppError("PATH_IN_USE", "一个项目不能重复绑定同一分析目录");
      for (const key of keys) {
        const used = this.db
          .prepare("SELECT project_id FROM repository_paths WHERE path_key = ?")
          .get(key) as { project_id: string } | undefined;
        if (used && used.project_id !== project.id)
          throw new AppError(
            "PATH_IN_USE",
            "分析目录已经关联到其他项目，请使用独立目录",
          );
      }
      this.db
        .prepare(
          "INSERT INTO projects VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, json=excluded.json",
        )
        .run(project.id, project.revision, JSON.stringify(project));
      this.db
        .prepare("DELETE FROM repository_paths WHERE project_id = ?")
        .run(project.id);
      const insert = this.db.prepare(
        "INSERT INTO repository_paths VALUES (?, ?)",
      );
      for (const key of keys) insert.run(key, project.id);
    })();
  }
  deleteProject(id: string, expectedRevision: number): void {
    this.db.transaction(() => {
      const project = this.getProject(id);
      if (project.revision !== expectedRevision)
        throw new AppError(
          "REVISION_CONFLICT",
          "项目配置已变化，请刷新后重新删除",
        );
      const active = this.db
        .prepare(
          `SELECT 1 FROM tasks WHERE project_id=? AND status IN (${ACTIVE_TASK_STATUSES.map(() => "?").join(",")}) LIMIT 1`,
        )
        .get(id, ...ACTIVE_TASK_STATUSES);
      if (active)
        throw new AppError("PROJECT_BUSY", "请先取消或等待项目任务结束");
      const deleted = {
        ...project,
        enabled: false,
        deletedAt: new Date().toISOString(),
        revision: project.revision + 1,
      };
      this.db
        .prepare("UPDATE projects SET revision=?,json=? WHERE id=?")
        .run(deleted.revision, JSON.stringify(deleted), id);
      this.db
        .prepare("DELETE FROM repository_paths WHERE project_id=?")
        .run(id);
    })();
  }
  listTasks(projectId?: string): Task[] {
    const query =
      "SELECT t.json FROM tasks t JOIN projects p ON p.id=t.project_id WHERE json_extract(p.json,'$.deletedAt') IS NULL" +
      (projectId ? " AND t.project_id=?" : "") +
      " ORDER BY t.created_at DESC,t.rowid DESC";
    const rows = this.db
      .prepare(query)
      .all(...(projectId ? [projectId] : [])) as JsonRow[];
    return rows.map((row) => JSON.parse(row.json) as Task);
  }
  getTask(id: string): Task {
    const row = this.db
      .prepare("SELECT json FROM tasks WHERE id = ?")
      .get(id) as JsonRow | undefined;
    if (!row) throw new AppError("TASK_NOT_FOUND", "任务不存在");
    return JSON.parse(row.json) as Task;
  }
  saveTask(task: Task): void {
    this.db
      .prepare(
        "INSERT INTO tasks VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status=excluded.status, json=excluded.json",
      )
      .run(
        task.id,
        task.projectId,
        task.status,
        task.createdAt,
        JSON.stringify(task),
      );
  }
  event(taskId: string, stage: string, message: string): void {
    this.db.transaction(() => {
      const row = this.db
        .prepare(
          "SELECT COALESCE(MAX(sequence), 0) AS seq FROM task_events WHERE task_id = ?",
        )
        .get(taskId) as { seq: number };
      const event: TaskEvent = {
        taskId,
        sequence: row.seq + 1,
        stage,
        message,
        timestamp: new Date().toISOString(),
      };
      this.db
        .prepare("INSERT INTO task_events VALUES (?, ?, ?)")
        .run(taskId, event.sequence, JSON.stringify(event));
    })();
  }
  taskEvents(id: string): TaskEvent[] {
    this.getTask(id);
    return (
      this.db
        .prepare(
          "SELECT json FROM task_events WHERE task_id = ? ORDER BY sequence",
        )
        .all(id) as JsonRow[]
    ).map((row) => JSON.parse(row.json) as TaskEvent);
  }
  completeTask(task: Task, context: ContextSnapshot): void {
    this.db.transaction(() => {
      if (task.projectId !== context.projectId)
        throw new AppError("CONTEXT_MISMATCH", "任务与快照不属于同一项目");
      this.db
        .prepare("INSERT INTO contexts VALUES (?, ?, ?)")
        .run(context.id, context.projectId, JSON.stringify(context));
      this.saveTask({
        ...task,
        status: "SUCCEEDED",
        updatedAt: new Date().toISOString(),
        contextSnapshotId: context.id,
        error: null,
      });
      this.event(task.id, "SUCCEEDED", "代码上下文准备成功，已固定提交版本");
    })();
  }
  getContext(id: string): ContextSnapshot {
    const row = this.db
      .prepare("SELECT json FROM contexts WHERE id = ?")
      .get(id) as JsonRow | undefined;
    if (!row) throw new AppError("CONTEXT_NOT_FOUND", "代码快照不存在");
    return JSON.parse(row.json) as ContextSnapshot;
  }
  latestContext(projectId: string): ContextSnapshot | null {
    const row = this.db
      .prepare(
        "SELECT json FROM contexts WHERE project_id = ? ORDER BY rowid DESC LIMIT 1",
      )
      .get(projectId) as JsonRow | undefined;
    return row ? (JSON.parse(row.json) as ContextSnapshot) : null;
  }
  async backup(destination: string): Promise<void> {
    await this.db.backup(destination);
  }
}
