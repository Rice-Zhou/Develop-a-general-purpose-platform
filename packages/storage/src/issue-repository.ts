import type Database from "better-sqlite3";
import { AppError } from "../../contracts/src/error";
import {
  IssueSnapshotSchema,
  BugReportSchema,
  type IssueSnapshot,
  type BugReport,
} from "../../contracts/src/issues";
export class IssueRepository {
  constructor(private readonly db: Database.Database) {}
  save(value: IssueSnapshot): void {
    const issue = IssueSnapshotSchema.parse(value);
    this.db
      .prepare("INSERT INTO issue_snapshots VALUES(?,?,?,?,?)")
      .run(
        issue.id,
        issue.projectId,
        issue.bindingId,
        issue.remoteId,
        JSON.stringify(issue),
      );
  }
  get(projectId: string, id: string): IssueSnapshot {
    const row = this.db
      .prepare("SELECT json FROM issue_snapshots WHERE id=? AND project_id=?")
      .get(id, projectId) as { json: string } | undefined;
    if (!row)
      throw new AppError("ISSUE_NOT_FOUND", "问题快照不属于当前项目或不存在");
    return IssueSnapshotSchema.parse(JSON.parse(row.json));
  }
  replaceBatch(
    projectId: string,
    bindingId: string,
    scopeHash: string,
    snapshots: IssueSnapshot[],
  ): void {
    this.db.transaction(() => {
      for (const issue of snapshots) {
        if (
          issue.projectId !== projectId ||
          issue.bindingId !== bindingId ||
          issue.scopeHash !== scopeHash
        )
          throw new AppError("ISSUE_OUT_OF_SCOPE", "问题批次范围不一致");
        this.save(issue);
      }
      this.db
        .prepare(
          "INSERT INTO issue_batches VALUES(?,?,?,?) ON CONFLICT(project_id,binding_id) DO UPDATE SET scope_hash=excluded.scope_hash,json=excluded.json",
        )
        .run(
          projectId,
          bindingId,
          scopeHash,
          JSON.stringify(snapshots.map((s) => s.id)),
        );
    })();
  }
  replaceBatches(batches: {projectId:string;bindingId:string;scopeHash:string;snapshots:IssueSnapshot[]}[]): void {
    this.db.transaction(()=>{for(const batch of batches)this.replaceBatch(batch.projectId,batch.bindingId,batch.scopeHash,batch.snapshots);})();
  }
  batch(
    projectId: string,
    bindingId: string,
    scopeHash: string,
  ): IssueSnapshot[] {
    const row = this.db
      .prepare(
        "SELECT json FROM issue_batches WHERE project_id=? AND binding_id=? AND scope_hash=?",
      )
      .get(projectId, bindingId, scopeHash) as { json: string } | undefined;
    return row
      ? (JSON.parse(row.json) as string[]).map((id) => this.get(projectId, id))
      : [];
  }
  saveReport(report: BugReport): void {
    const value = BugReportSchema.parse(report);
    this.get(value.projectId, value.issueSnapshotId);
    this.db
      .prepare("INSERT INTO bug_reports VALUES(?,?,?,?)")
      .run(value.id, value.projectId, value.taskId, JSON.stringify(value));
  }
  reports(projectId: string): BugReport[] {
    return (
      this.db
        .prepare(
          "SELECT json FROM bug_reports WHERE project_id=? ORDER BY rowid DESC",
        )
        .all(projectId) as { json: string }[]
    ).map((r) => BugReportSchema.parse(JSON.parse(r.json)));
  }
  report(projectId: string, id: string): BugReport {
    const row = this.db
      .prepare("SELECT json FROM bug_reports WHERE id=? AND project_id=?")
      .get(id, projectId) as { json: string } | undefined;
    if (!row)
      throw new AppError("REPORT_NOT_FOUND", "BUG 报告不属于当前项目或不存在");
    return BugReportSchema.parse(JSON.parse(row.json));
  }
}
