import { useEffect, useState } from "react";
import type {
  DesktopAPI,
  Project,
  Task,
} from "../../../../../packages/contracts/src/models";
import type {
  BugReport,
  IssueSnapshot,
} from "../../../../../packages/contracts/src/issues";
import { message, unwrap } from "../api";
import { BugReportPage } from "./BugReportPage";
type Detail = Extract<
  Awaited<ReturnType<DesktopAPI["getBugReport"]>>,
  { ok: true }
>["value"];
export function BugsPage({
  projects,
  tasks,
  onChanged,
}: {
  projects: Project[];
  tasks: Task[];
  onChanged: () => Promise<void>;
}) {
  const [projectId, setProjectId] = useState("");
  const [workspace, setWorkspace] = useState<{
    issues: IssueSnapshot[];
    reports: BugReport[];
  }>({ issues: [], reports: [] });
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const completed = tasks.find(
    (t) => t.projectId === projectId && t.status === "SUCCEEDED",
  )?.id;
  useEffect(() => {
    if (!projects.some((p) => p.id === projectId))
      setProjectId(projects[0]?.id ?? "");
  }, [projects, projectId]);
  useEffect(() => {
    setDetail(null);
    setKeys({});
    setError("");
    setNotice("");
  }, [projectId]);
  useEffect(() => {
    setWorkspace({ issues: [], reports: [] });
    if (!projectId) return;
    let live = true;
    void window.platform
      .getBugWorkspace(projectId)
      .then((r) => {
        if (live) setWorkspace(unwrap(r));
      })
      .catch((e) => {
        if (live) setError(message(e));
      });
    return () => {
      live = false;
    };
  }, [projectId, completed]);
  const project = projects.find((p) => p.id === projectId);
  const active = tasks.some(
    (t) =>
      t.projectId === projectId &&
      ["QUEUED", "PREPARING", "RUNNING", "VALIDATING", "CANCELLING"].includes(
        t.status,
      ),
  );
  const busy = loading || active;
  const latest = tasks.find(
    (t) => t.projectId === projectId && t.kind === "ANALYZE_BUG",
  );
  async function act(action: () => Promise<void>) {
    setLoading(true);
    setError("");
    setNotice("");
    try {
      await action();
      setWorkspace(unwrap(await window.platform.getBugWorkspace(projectId)));
      await onChanged();
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }
  if (detail && detail.report.projectId === projectId)
    return <BugReportPage {...detail} onClose={() => setDetail(null)} />;
  return (
    <div className="workspace-stack">
      <section className="panel work-panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">PROJECT ISSUE INTAKE</span>
            <h2>BUG 读取与预分析</h2>
          </div>
          <label>
            当前 BUG 项目
            <select
              disabled={busy}
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="muted">
          只读操作，始终限制项目与负责人。分析前重新读取
          BUG、安全更新配置分支并固定代码；定时监控尚未开启。
        </p>
        {error && (
          <div className="error-panel" role="alert">
            {error}
          </div>
        )}
        {notice && <div className="notice">{notice}</div>}
        {latest?.error && (
          <div className="error-panel">
            {latest.error.code}：{latest.error.message}
          </div>
        )}
        {active && (
          <div className="notice">
            任务正在队列中执行，可在任务历史取消或查看步骤。
          </div>
        )}
        {!project?.issueBindings.length && (
          <p className="muted">
            请先在设置添加来源连接，再为项目配置 BUG 范围。
          </p>
        )}
        {project?.issueBindings.map((b) => (
          <article className="binding-form" key={b.id}>
            <strong>
              {b.platform === "trinity" ? "Trinity" : "Jira"} · 项目{" "}
              {b.projectKey} · 负责人 {b.owner}
            </strong>
            {!b.connectionId && (
              <p className="coverage-warning">
                旧范围尚未关联来源连接，请编辑项目配置。
              </p>
            )}
            <div className="row-actions">
              <button
                className="secondary"
                disabled={
                  busy ||
                  !project.enabled ||
                  !b.connectionId ||
                  b.platform === "trinity"
                }
                onClick={() =>
                  void act(async () => {
                    unwrap(
                      await window.platform.refreshIssues(projectId, b.id),
                    );
                    setNotice("项目范围读取完成；未自动分析存量问题。");
                  })
                }
              >
                读取项目 BUG
              </button>
              <input
                aria-label={`BUG 编号 ${b.id}`}
                placeholder="BUG 编号"
                value={keys[b.id] ?? ""}
                onChange={(e) => setKeys({ ...keys, [b.id]: e.target.value })}
              />
              <button
                className="secondary"
                disabled={
                  busy ||
                  !project.enabled ||
                  !b.connectionId ||
                  !keys[b.id]?.trim()
                }
                onClick={() =>
                  void act(async () => {
                    unwrap(
                      await window.platform.readIssueByKey(
                        projectId,
                        b.id,
                        keys[b.id].trim(),
                      ),
                    );
                  })
                }
              >
                按编号读取
              </button>
            </div>
            {b.platform === "trinity" && (
              <p className="muted small">
                Trinity 项目列表契约待验证；按编号读取后仍检查返回项目和负责人。
              </p>
            )}
          </article>
        ))}
      </section>
      <section className="panel work-panel">
        <h2>范围内问题</h2>
        {workspace.issues.length === 0 && (
          <p className="muted">
            尚未读取到范围内问题。成功空列表也只代表本次所配置范围。
          </p>
        )}
        {workspace.issues.map((issue) => (
          <article className="finding-card" key={issue.id}>
            <div className="section-heading">
              <h3>
                {issue.key} · {issue.title}
              </h3>
              <span className="tag">{issue.status}</span>
            </div>
            <p className="muted small">
              {issue.ownerId} · 问题版本 {issue.versions.join("、") || "未提供"}{" "}
              · 更新 {issue.updatedAt}
            </p>
            <p style={{ whiteSpace: "pre-wrap" }}>{issue.description}</p>
            <details>
              <summary>已读取评论与材料缺口</summary>
              {issue.comments.map((c) => (
                <p key={c.id}>{c.text}</p>
              ))}
              <ul>
                {issue.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </details>
            <button
              className="primary"
              disabled={busy || !project?.enabled || !project?.aiProfileId}
              onClick={() =>
                void act(async () => {
                  unwrap(await window.platform.analyzeBug(projectId, issue.id));
                  setNotice("预分析任务已加入队列，将重新校验问题并更新代码。");
                })
              }
            >
              更新代码并预分析
            </button>
          </article>
        ))}
      </section>
      <section className="panel work-panel">
        <h2>BUG 报告历史</h2>
        {workspace.reports.length === 0 && (
          <p className="muted">尚无成功预分析报告。</p>
        )}
        {workspace.reports.map((r) => (
          <div className="report-list-item" key={r.id}>
            <span>{new Date(r.createdAt).toLocaleString()} · 静态预分析</span>
            <button
              className="secondary"
              disabled={loading}
              onClick={() =>
                void act(async () => {
                  setDetail(
                    unwrap(await window.platform.getBugReport(projectId, r.id)),
                  );
                })
              }
            >
              查看 BUG 报告
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}
