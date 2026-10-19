import type Database from "better-sqlite3";
import { AppError } from "../../contracts/src/error";
import {
  DocumentSnapshotSchema,
  type DocumentSnapshot,
} from "../../contracts/src/documents";
import {
  RequirementSetSchema,
  type RequirementSet,
} from "../../contracts/src/requirements";
import {
  AnalysisReportSchema,
  type AnalysisReport,
} from "../../contracts/src/analysis";
import type { Task, ContextSnapshot } from "../../contracts/src/models";
import type { BugReport } from "../../contracts/src/issues";
import { IssueRepository } from "./issue-repository";
export abstract class AnalysisRepository {
  readonly issues: IssueRepository;
  constructor(protected readonly db: Database.Database) {
    this.issues = new IssueRepository(db);
  }
  abstract saveTask(task: Task): void;
  abstract event(taskId: string, stage: string, message: string): void;
  saveDocument(value: DocumentSnapshot): void {
    const snapshot = DocumentSnapshotSchema.parse(value);
    this.db
      .prepare("INSERT INTO documents VALUES(?,?,?)")
      .run(snapshot.id, snapshot.projectId, JSON.stringify(snapshot));
  }
  getDocument(projectId: string, id: string): DocumentSnapshot {
    const row = this.db
      .prepare("SELECT json FROM documents WHERE id=? AND project_id=?")
      .get(id, projectId) as { json: string } | undefined;
    if (!row)
      throw new AppError("DOCUMENT_NOT_FOUND", "文档不属于当前项目或不存在");
    return DocumentSnapshotSchema.parse(JSON.parse(row.json));
  }
  saveRequirementSet(value: RequirementSet, expectedRevision: number): void {
    const set = RequirementSetSchema.parse(value);
    this.db.transaction(() => {
      const context = this.db
        .prepare("SELECT 1 FROM contexts WHERE id=? AND project_id=?")
        .get(set.contextSnapshotId, set.projectId);
      if (!context)
        throw new AppError("CONTEXT_MISMATCH", "需求上下文不属于当前项目");
      const row = this.db
        .prepare(
          "SELECT COALESCE(MAX(revision),0) AS revision FROM requirement_sets WHERE project_id=?",
        )
        .get(set.projectId) as { revision: number };
      if (
        row.revision !== expectedRevision ||
        set.revision !== expectedRevision + 1
      )
        throw new AppError("REVISION_CONFLICT", "需求已更新，请重新加载");
      this.db
        .prepare("INSERT INTO requirement_sets VALUES(?,?,?,?,?)")
        .run(
          set.id,
          set.projectId,
          set.contextSnapshotId,
          set.revision,
          JSON.stringify(set),
        );
    })();
  }
  getRequirementSet(projectId: string, id: string): RequirementSet {
    const row = this.db
      .prepare("SELECT json FROM requirement_sets WHERE id=? AND project_id=?")
      .get(id, projectId) as { json: string } | undefined;
    if (!row)
      throw new AppError(
        "REQUIREMENTS_NOT_FOUND",
        "需求版本不属于当前项目或不存在",
      );
    return RequirementSetSchema.parse(JSON.parse(row.json));
  }
  latestRequirementSet(projectId: string): RequirementSet | null {
    const row = this.db
      .prepare(
        "SELECT json FROM requirement_sets WHERE project_id=? ORDER BY revision DESC LIMIT 1",
      )
      .get(projectId) as { json: string } | undefined;
    return row ? RequirementSetSchema.parse(JSON.parse(row.json)) : null;
  }
  listReports(projectId: string): AnalysisReport[] {
    return (
      this.db
        .prepare(
          "SELECT json FROM reports WHERE project_id=? ORDER BY rowid DESC",
        )
        .all(projectId) as { json: string }[]
    ).map((row) => AnalysisReportSchema.parse(JSON.parse(row.json)));
  }
  getReport(projectId: string, id: string): AnalysisReport {
    const row = this.db
      .prepare("SELECT json FROM reports WHERE id=? AND project_id=?")
      .get(id, projectId) as { json: string } | undefined;
    if (!row)
      throw new AppError("REPORT_NOT_FOUND", "报告不属于当前项目或不存在");
    return AnalysisReportSchema.parse(JSON.parse(row.json));
  }
  getSetting<T>(key: string): T | null {
    const row = this.db
      .prepare("SELECT json FROM settings WHERE key=?")
      .get(key) as { json: string } | undefined;
    return row ? (JSON.parse(row.json) as T) : null;
  }
  setSetting(key: string, value: unknown): void {
    this.db
      .prepare(
        "INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json",
      )
      .run(key, JSON.stringify(value));
  }
  private finish(task: Task, context: ContextSnapshot): void {
    if (task.projectId !== context.projectId)
      throw new AppError("CONTEXT_MISMATCH", "任务与上下文不属于同一项目");
    this.db
      .prepare("INSERT INTO contexts VALUES(?,?,?)")
      .run(context.id, context.projectId, JSON.stringify(context));
    this.saveTask({
      ...task,
      status: "SUCCEEDED",
      contextSnapshotId: context.id,
      updatedAt: new Date().toISOString(),
      error: null,
    });
    this.event(task.id, "SUCCEEDED", "分析结果已保存，证据绑定固定版本");
  }
  completeBug(task: Task, context: ContextSnapshot, report: BugReport): void {
    this.db.transaction(() => {
      if (
        report.taskId !== task.id ||
        report.projectId !== task.projectId ||
        report.contextSnapshotId !== context.id ||
        report.issueSnapshotId !== context.issueSnapshotId
      )
        throw new AppError("CONTEXT_MISMATCH", "BUG 报告与任务上下文不一致");
      this.finish(task, context);
      this.issues.saveReport(report);
    })();
  }
  completeExtraction(
    task: Task,
    context: ContextSnapshot,
    set: RequirementSet,
  ): void {
    this.db.transaction(() => {
      this.finish(task, context);
      if (
        set.contextSnapshotId !== context.id ||
        set.projectId !== task.projectId
      )
        throw new AppError("CONTEXT_MISMATCH", "需求结果上下文不匹配");
      this.saveRequirementSet(set, set.revision - 1);
    })();
  }
  completeAnalysis(
    task: Task,
    context: ContextSnapshot,
    value: AnalysisReport,
  ): void {
    const report = AnalysisReportSchema.parse(value);
    this.db.transaction(() => {
      this.finish(task, context);
      if (
        report.taskId !== task.id ||
        report.projectId !== task.projectId ||
        report.contextSnapshotId !== context.id ||
        report.attemptId !== task.attemptId
      )
        throw new AppError("CONTEXT_MISMATCH", "报告与任务或上下文不匹配");
      this.db
        .prepare("INSERT INTO reports VALUES(?,?,?,?)")
        .run(report.id, report.projectId, task.id, JSON.stringify(report));
    })();
  }
  replaceSearchChunks(
    projectId: string,
    contextId: string,
    chunks: { id: string; text: string; metadata: unknown }[],
  ): void {
    this.db.transaction(() => {
      const rows = this.db
        .prepare(
          "SELECT id FROM search_chunks WHERE project_id=? AND context_id=?",
        )
        .all(projectId, contextId) as { id: string }[];
      for (const row of rows)
        this.db.prepare("DELETE FROM search_fts WHERE id=?").run(row.id);
      this.db
        .prepare(
          "DELETE FROM search_chunks WHERE project_id=? AND context_id=?",
        )
        .run(projectId, contextId);
      for (const c of chunks) {
        this.db
          .prepare("INSERT INTO search_chunks VALUES(?,?,?,?,?)")
          .run(c.id, projectId, contextId, JSON.stringify(c.metadata), c.text);
        this.db
          .prepare("INSERT INTO search_fts(id,text) VALUES(?,?)")
          .run(c.id, c.text);
      }
    })();
  }
  searchChunks(
    projectId: string,
    contextId: string,
    query: string,
    limit: number,
  ): { text: string; metadata: unknown }[] {
    const long = [...query].length >= 3;
    const sql = long
      ? "SELECT c.text,c.json FROM search_fts f JOIN search_chunks c ON c.id=f.id WHERE search_fts MATCH ? AND c.project_id=? AND c.context_id=? LIMIT ?"
      : "SELECT text,json FROM search_chunks WHERE project_id=? AND context_id=? AND instr(text,?)>0 LIMIT ?";
    const rows = (
      long
        ? this.db
            .prepare(sql)
            .all(
              '"' + query.replaceAll('"', '""') + '"',
              projectId,
              contextId,
              limit,
            )
        : this.db.prepare(sql).all(projectId, contextId, query, limit)
    ) as { text: string; json: string }[];
    return rows.map((row) => ({
      text: row.text,
      metadata: JSON.parse(row.json),
    }));
  }
}
