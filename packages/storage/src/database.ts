import { LibraryStore } from "./library-store";
import { isDocumentResource,type LibraryResourceDraft,type LibraryCategoryDraft,type ProjectResourceLink } from "../../contracts/src/library";
import { isDeepStrictEqual } from "node:util";
import type { IssueConnection } from "../../contracts/src/issues";
import { resolveIssueBindings } from "../../core/src/issues/bindings";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { migrateDatabase } from "./migrations";
import { AnalysisRepository } from "./analysis-repository";
import { AppError } from "../../contracts/src/error";
import { DocumentResourceDraftSchema, type DocumentResource } from "../../contracts/src/models";
import { randomUUID } from "node:crypto";
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
  override setSetting(key: string, value: unknown): void {
    if (key !== "issue-connections") { super.setSetting(key, value); return; }
    const next = value as IssueConnection[];
    if (next.filter(c => c.platform === "trinity").length > 1) throw new AppError("TRINITY_ACCOUNT_UNIQUE", "Trinity 仅允许一个当前登录账号，请编辑已有账号连接");
    const previous = this.getSetting<IssueConnection[]>(key) ?? [];
    const accountChanged = !isDeepStrictEqual(previous.find(c => c.platform === "trinity"), next.find(c => c.platform === "trinity"));
    const changed = new Set([...previous, ...next].filter(c => !isDeepStrictEqual(previous.find(p => p.id === c.id), next.find(p => p.id === c.id))).map(c => c.id));
    const removed = new Set(previous.filter(c => !next.some(n => n.id === c.id)).map(c => c.id));
    this.db.transaction(() => {
      super.setSetting(key, value);
      this.touchProjects(
        p => accountChanged || p.issueBindings?.some(b => Boolean(b.connectionId && changed.has(b.connectionId))),
        p => ({ ...p, issueBindings: p.issueBindings.filter(b => !b.connectionId || !removed.has(b.connectionId)) }),
      );
    })();
  }
  getLibrary(){const library=new LibraryStore(this.db);return {resources:library.resources(),categories:library.categories()};}
  saveLibraryResource(draft:LibraryResourceDraft,expectedRevision?:number){return new LibraryStore(this.db).saveResource(draft,expectedRevision);}
  deleteLibraryResource(id:string,revision:number){new LibraryStore(this.db).deleteResource(id,revision);}
  saveLibraryCategory(draft:LibraryCategoryDraft,expectedRevision?:number){return new LibraryStore(this.db).saveCategory(draft,expectedRevision);}
  deleteLibraryCategory(id:string,revision:number){new LibraryStore(this.db).deleteCategory(id,revision);}
  saveProjectResources(projectId:string,links:ProjectResourceLink[],expectedRevision:number):Project{return this.db.transaction(()=>{const p=this.getProject(projectId);new LibraryStore(this.db).replaceLinks(projectId,links);this.saveProject({...p,resourceLinks:links,documents:links.filter(l=>l.role==="requirement").map(l=>{const r=this.getLibrary().resources.find(r=>r.id===l.resourceId)!;if(!isDocumentResource(r))throw new AppError("RESOURCE_REFERENCE_ONLY","仅支持参考关联");return {id:r.id,kind:r.kind,locator:r.locator,required:l.required};}),revision:p.revision+1,updatedAt:new Date().toISOString()},expectedRevision);return this.getProject(projectId);})();}
  documentResources(): DocumentResource[] { return this.getLibrary().resources.filter(isDocumentResource).map(r=>({id:r.id,name:r.name,kind:r.kind,locator:r.locator,required:r.required,revision:r.revision})); }
  getDefaultAIProfile(): string | null { return this.getSetting<string>("default-ai-profile"); }
  setDefaultAIProfile(id: string): void {
    if (!(this.getSetting<{ id: string }[]>("profiles") ?? []).some(p => p.id === id)) throw new AppError("MODEL_NOT_CONFIGURED", "AI 连接不存在");
    if (id === this.getDefaultAIProfile()) return;
    this.db.transaction(() => {
      this.setSetting("default-ai-profile", id);
      this.touchProjects(p => !p.aiProfileId && p.usesDefaultAI !== false);
    })();
  }
  deleteAIProfile(id: string, replacementId: string | null): void {
    this.db.transaction(() => {
      const profiles = this.getSetting<{ id: string }[]>("profiles") ?? [];
      if (!profiles.some(p => p.id === id)) throw new AppError("MODEL_NOT_CONFIGURED", "AI 连接不存在");
      if (replacementId === id || (replacementId !== null && !profiles.some(p => p.id === replacementId)))
        throw new AppError("MODEL_REPLACEMENT_INVALID", "请选择其他有效 AI 连接，或明确解除关联");
      const deletingDefault = this.getDefaultAIProfile() === id;
      const projects = (this.db.prepare("SELECT json FROM projects").all() as JsonRow[]).map(row => JSON.parse(row.json) as Project);
      const affected = projects.filter(p => p.aiProfileId === id || (deletingDefault && !p.aiProfileId && p.usesDefaultAI !== false));
      const independentKinds: readonly Task["kind"][] = ["DOWNLOAD_ISSUE_LOGS", "PREPARE_CONTEXT", "UPDATE_CODE", "CONTINUE_CODE_UPDATE"];
      const active = this.db.prepare(`SELECT 1 FROM tasks WHERE project_id=? AND status IN (${ACTIVE_TASK_STATUSES.map(() => "?").join(",")}) AND COALESCE(json_extract(json,'$.kind'),'') NOT IN (${independentKinds.map(() => "?").join(",")}) LIMIT 1`);
      if (affected.some(p => active.get(p.id, ...ACTIVE_TASK_STATUSES, ...independentKinds)))
        throw new AppError("MODEL_TASK_ACTIVE", "该 AI 连接关联的项目仍有活动任务，请先取消任务并等待取消完成，再删除连接");
      for (const project of affected) {
        const explicit = project.aiProfileId === id;
        const updated = { ...project, ...(explicit || replacementId === null ? { aiProfileId: replacementId, usesDefaultAI: false } : {}), revision: project.revision + 1, updatedAt: new Date().toISOString() };
        this.db.prepare("UPDATE projects SET revision=?,json=? WHERE id=?").run(updated.revision, JSON.stringify(updated), updated.id);
      }
      if (deletingDefault) this.setSetting("default-ai-profile", replacementId);
      this.setSetting("profiles", profiles.filter(p => p.id !== id));
      this.setSetting(`ai-protocol:${id}`, null);
    })();
  }
  private touchProjects(
    matches: (project: Project & { documentRefs?: { id: string; required: boolean }[] }) => boolean,
    transform: (project: Project) => Project = project => project,
  ): void {
    for (const row of this.db.prepare("SELECT json FROM projects WHERE json_extract(json,'$.deletedAt') IS NULL").all() as JsonRow[]) {
      const project = JSON.parse(row.json) as Project;
      if (!matches(project)) continue;
      const updated = { ...transform(project), revision: project.revision + 1, updatedAt: new Date().toISOString() };
      this.db.prepare("UPDATE projects SET revision=?,json=? WHERE id=?").run(updated.revision, JSON.stringify(updated), updated.id);
    }
  }
  saveDocumentResource(value:unknown,expectedRevision?:number):DocumentResource {
    const draft=DocumentResourceDraftSchema.parse(value);const previous=draft.id?this.getLibrary().resources.find(r=>r.id===draft.id):undefined;
    const r=this.saveLibraryResource({...previous,...draft},expectedRevision);if(!isDocumentResource(r))throw new AppError("RESOURCE_REFERENCE_ONLY","不是可解析文档");return {id:r.id,name:r.name,kind:r.kind,locator:r.locator,required:r.required,revision:r.revision};
  }
  deleteDocumentResource(id:string,expectedRevision:number):void {this.deleteLibraryResource(id,expectedRevision);}
  private hydrateProject(raw:string):Project {
    const project=JSON.parse(raw) as Project;
    project.resourceLinks=new LibraryStore(this.db).links(project.id);
    const resources=this.getLibrary().resources;
    project.documents=project.resourceLinks.filter(l=>l.role==="requirement").map(l=>{const r=resources.find(r=>r.id===l.resourceId);if(!r||!isDocumentResource(r))throw new AppError("DOCUMENT_NOT_FOUND","项目关联的需求文档资源不存在");return {id:r.id,kind:r.kind,locator:r.locator,required:l.required};});
    project.issueBindings=resolveIssueBindings(project,this.getSetting<IssueConnection[]>("issue-connections")??[]);
    const defaultId=this.getDefaultAIProfile();if(!project.aiProfileId&&project.usesDefaultAI!==false){project.aiProfileId=defaultId;project.usesDefaultAI=true;}
    return project;
  }
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
    ).map((row) => this.hydrateProject(row.json));
  }
  getProject(id: string): Project {
    const row = this.db
      .prepare(
        "SELECT json FROM projects WHERE id = ? AND json_extract(json,'$.deletedAt') IS NULL",
      )
      .get(id) as JsonRow | undefined;
    if (!row) throw new AppError("PROJECT_NOT_FOUND", "项目不存在");
    return this.hydrateProject(row.json);
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
      const resources = this.documentResources();
      for (const document of project.documents) {
        const previous = resources.find(r => r.id === document.id);
        if (previous && (previous.kind !== document.kind || previous.locator !== document.locator)) throw new AppError("DOCUMENT_RESOURCE_CHANGED", "请在需求资料库中修改文档资源，再重新关联");
        if (!previous) this.db.prepare("INSERT INTO library_resources VALUES(?,?)").run(document.id,JSON.stringify({...document,name:document.locator.split(/[\\/]/).at(-1)||document.locator,revision:1,contentRevision:1,categoryId:null,purpose:"requirement",notes:""}));
      }

      const { usesDefaultAI, resourceLinks: _resourceLinks, ...persisted } = project;
      const trinityProjects = project.trinityProjects ?? project.issueBindings.filter(b => b.platform === "trinity" && b.scopeMode !== "account").map(b => ({ instanceUrl: b.instanceUrl, projectId: b.projectKey }));
      const json = { ...persisted, ...(usesDefaultAI === false ? { usesDefaultAI: false } : {}), ...(trinityProjects.length || project.trinityProjects ? { trinityProjects } : {}), issueBindings: project.issueBindings.filter(b => b.platform !== "trinity"), aiProfileId: usesDefaultAI ? null : project.aiProfileId, documents: [] };
      this.db
        .prepare(
          "INSERT INTO projects VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, json=excluded.json",
        )
        .run(project.id, project.revision, JSON.stringify(json));
      const library=new LibraryStore(this.db);
      const references=library.links(project.id).filter(l=>l.role==="reference"&&!project.documents.some(d=>d.id===l.resourceId));
      library.replaceLinks(project.id,[...references,...project.documents.map(d=>({resourceId:d.id,role:"requirement" as const,required:d.required}))]);
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
      "SELECT t.json FROM tasks t JOIN projects p ON p.id=t.project_id WHERE json_extract(p.json,'$.deletedAt') IS NULL AND json_extract(t.json,'$.deletedAt') IS NULL" +
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
