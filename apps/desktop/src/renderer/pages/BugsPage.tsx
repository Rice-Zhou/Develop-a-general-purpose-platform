import { useEffect, useRef, useState } from "react";
import type {
  DesktopAPI,
  Project,
  Task,
} from "../../../../../packages/contracts/src/models";
import type {
  BugReport,
} from "../../../../../packages/contracts/src/issues";
import { message, unwrap } from "../api";
import { BugReportPage } from "./BugReportPage";
import { IssueMonitorSettings } from "../components/IssueMonitorSettings";
import type { IssueListItem, IssueSourceState } from "../../../../../packages/contracts/src/issue-monitor";
type Detail = Extract<
  Awaited<ReturnType<DesktopAPI["getBugReport"]>>,
  { ok: true }
>["value"];
export function BugsPage({
  projects,
  tasks,
  onChanged,
  onConfigureAI,
  onEditProject,
}: {
  projects: Project[];
  tasks: Task[];
  onChanged: () => Promise<void>;
  onConfigureAI: () => void;
  onEditProject: (project: Project) => void;
}) {
  const [projectId, setProjectId] = useState("");
  const [workspace, setWorkspace] = useState<{
    scope: string;
    issues: IssueListItem[];
    sources: IssueSourceState[];
    reports: BugReport[];
  }>({ scope: "", issues: [], reports: [], sources: [] });
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const foreground = useRef(false);
  const project = projects.find((p) => p.id === projectId);
  const scope = JSON.stringify([
    project?.id,
    project?.enabled,
    project?.issueBindings,
  ]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const operation = useRef(0);
  const mounted = useRef(true);
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
    setLoading(false);
    foreground.current = false;
    operation.current++;
  }, [scope]);
  useEffect(() => {
    if (!projectId) {
      setWorkspace({ scope: "", issues: [], reports: [], sources: [] });
      return;
    }
    let live = true;
    let reading = false;
    const load = async () => {
      if (reading || foreground.current) return;
      reading = true;
      const request = operation.current;
      try {
        const next = unwrap(await window.platform.getBugWorkspace(projectId));
        if (live && !foreground.current && currentScope.current === scope && operation.current === request)
          setWorkspace({ ...next, scope });
      } catch (e) {
        if (live && currentScope.current === scope && operation.current === request) setError(message(e));
      } finally { reading = false; }
    };
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => { live = false; clearInterval(timer); };
  }, [projectId, scope, completed]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const issues = (workspace.scope === scope ? workspace.issues : []).filter(
    (issue) =>
      issue.projectId === projectId &&
      project?.issueBindings.some((binding) => binding.id === issue.bindingId),
  );
  const reports = workspace.scope === scope ? workspace.reports : [];
  const sources = workspace.scope === scope ? workspace.sources : [];
  const allRefreshed = sources.length > 0 && sources.every(source => source.status === "success");
  const refreshFailed = sources.some(source => source.status === "failed");
  const active = tasks.some(
    (t) =>
      t.projectId === projectId &&
      ["QUEUED", "PREPARING", "RUNNING", "VALIDATING", "CANCELLING"].includes(
        t.status,
      ),
  );
  const busy = loading || active;
  const analysisUnavailable = !project?.enabled
    ? "预分析不可用：项目已停用，请在项目配置中启用。"
    : active
      ? "预分析不可用：当前项目有任务执行中，请等待完成或到任务历史取消。"
      : loading
        ? "预分析不可用：正在读取或提交请求，请稍候。"
        : !project.aiProfileId
          ? "预分析不可用：当前项目未关联 AI 执行连接，请先配置并关联。"
          : "";
  const latest = tasks.find(
    (t) => t.projectId === projectId && t.kind === "ANALYZE_BUG",
  );
  async function act(
    action: () => Promise<unknown>,
    successNotice = "",
    onSuccess?: (value: unknown) => void,
  ) {
    const request = ++operation.current;
    const valid = () =>
      mounted.current &&
      currentScope.current === scope &&
      operation.current === request;
    foreground.current = true;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const result = await action();
      if (!valid()) return;
      const next = unwrap(await window.platform.getBugWorkspace(projectId));
      if (!valid()) return;
      setWorkspace({ ...next, scope });
      onSuccess?.(result);
      setNotice(successNotice);
      await onChanged();
    } catch (e) {
      if (valid()) setError(message(e));
    } finally {
      if (valid()) { foreground.current = false; setLoading(false); }
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
          BUG、安全更新配置分支并固定代码。所有已配置来源统一读取和展示。
          Jira 仅索引修复中、分析中、分配中的问题。
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
        {project && !project.aiProfileId && (
          <div className="notice">
            <p>当前项目未关联 AI 执行连接。请先在设置创建连接，再在项目配置中选择。</p>
            <div className="row-actions">
              <button className="secondary" onClick={onConfigureAI}>配置 AI 连接</button>
              <button className="secondary" onClick={() => onEditProject(project)}>关联 AI 连接</button>
            </div>
          </div>
        )}
        {!project?.issueBindings.length && (
          <p className="muted">
            请先在设置添加来源连接，再为项目配置 BUG 范围。
          </p>
        )}
        <IssueMonitorSettings onConfigure={onConfigureAI} />
        <details>
          <summary>按编号读取（可选）</summary>
          {project?.issueBindings.map(b => (
            <div className="binding-form" key={b.id}>
              <strong>{sources.find(source => source.bindingId === b.id)?.label ?? b.projectKey}</strong>
              <div className="row-actions">
                <input aria-label={`BUG 编号 ${b.id}`} placeholder="BUG 编号" value={keys[b.id] ?? ""}
                  onChange={e => setKeys({ ...keys, [b.id]: e.target.value })} />
                <button className="secondary" disabled={busy || !project.enabled || !b.connectionId || !keys[b.id]?.trim()}
                  onClick={() => void act(async () => unwrap(await window.platform.readIssueByKey(projectId, b.id, keys[b.id].trim())), "问题已读取并加入当前列表。")}>按编号读取</button>
              </div>
            </div>
          ))}
        </details>
      </section>
      <section className="panel work-panel">
        <div className="section-heading">
          <h2>范围内问题</h2>
          <button
            className="secondary"
            disabled={
              busy ||
              !project?.enabled ||
              !project.issueBindings.length
            }
            onClick={() => void act(async () => unwrap(await window.platform.refreshBugWorkspace(projectId)))}
          >
            刷新问题单
          </button>
        </div>
        <p className="muted small">一次获取当前项目全部来源，无需切换平台。某个来源失败时，其余来源仍正常展示；失败来源的缓存仅代表上次读取的材料。</p>
        {sources.map(source => (
          <div key={source.bindingId} className={source.error ? "error-panel" : "muted small"} role={source.error ? "alert" : undefined}>
            {source.label} · {source.status === "success" ? `刷新成功：${source.count} 条问题` : source.status === "failed" ? "刷新失败；缓存仅代表上次读取的材料" : "此范围尚未刷新"}
            {source.lastSuccessAt && ` · 最近成功 ${new Date(source.lastSuccessAt).toLocaleString()}`}
            {source.error && <p>{source.error.code}：{source.error.message}</p>}
            {project && source.error?.code === "ISSUE_NOT_CONFIGURED" && <button className="secondary" onClick={() => onEditProject(project)}>重新关联来源</button>}
          </div>
        ))}
        {!allRefreshed && !refreshFailed && <p className="muted">尚未刷新当前配置范围；缓存仅代表上次读取的材料。</p>}
        {allRefreshed && issues.length === 0 && (
          <p className="muted">当前配置项目及负责人范围内无任何问题</p>
        )}
        {issues.map((issue) => (
          <article className="finding-card" key={issue.id}>
            <div className="section-heading">
              <h3>
                <a href={issue.webUrl} onClick={event => {
                  event.preventDefault();
                  void act(async () => unwrap(await window.platform.openIssue(projectId, issue.id)));
                }}>{issue.key}</a> {" "}
                · {issue.title}
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
              disabled={!!analysisUnavailable}
              title={analysisUnavailable || undefined}
              aria-describedby={analysisUnavailable ? `analysis-reason-${issue.id}` : undefined}
              onClick={() =>
                void act(async () => {
                  unwrap(await window.platform.analyzeBug(projectId, issue.id));
                }, "预分析任务已加入队列，将重新校验问题并更新代码。")
              }
            >
              更新代码并预分析
            </button>
            {analysisUnavailable && (
              <p id={`analysis-reason-${issue.id}`} className="coverage-warning">{analysisUnavailable}</p>
            )}
          </article>
        ))}
      </section>
      <section className="panel work-panel">
        <h2>BUG 报告历史</h2>
        {reports.length === 0 && (
          <p className="muted">暂无已加载的成功预分析报告。</p>
        )}
        {reports.map((r) => (
          <div className="report-list-item" key={r.id}>
            <span>{new Date(r.createdAt).toLocaleString()} · 静态预分析</span>
            <button
              className="secondary"
              disabled={loading}
              onClick={() =>
                void act(
                  async () => {
                    return unwrap(
                      await window.platform.getBugReport(projectId, r.id),
                    );
                  },
                  "",
                  (value) => setDetail(value as Detail),
                )
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
