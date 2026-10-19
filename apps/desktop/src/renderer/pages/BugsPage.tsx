import { useEffect, useRef, useState } from "react";
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
type RefreshState = {
  status: "refreshing" | "success" | "failed";
};
function unavailable(binding: Project["issueBindings"][number]): string {
  if (!binding.connectionId) return "尚未刷新：缺少来源连接，请编辑项目配置。";
  if (!binding.issueTypeIds?.length)
    return "尚未刷新：缺少 BUG 类型 ID，请编辑项目配置。";
  if (binding.platform === "trinity")
    return "尚未刷新：Trinity 项目列表契约待验证，仅支持按编号读取。";
  return "";
}
function jiraLink(issue: IssueSnapshot): string | null {
  const url = new URL(issue.instanceUrl);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
  )
    return null;
  return (
    url.href.replace(/\/$/, "") + "/browse/" + encodeURIComponent(issue.key)
  );
}
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
    scope: string;
    issues: IssueSnapshot[];
    reports: BugReport[];
  }>({ scope: "", issues: [], reports: [] });
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [refreshes, setRefreshes] = useState<Record<string, RefreshState>>({});
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
    setRefreshes({});
    operation.current++;
  }, [scope]);
  useEffect(() => {
    if (!projectId) {
      setWorkspace({ scope: "", issues: [], reports: [] });
      return;
    }
    let live = true;
    const request = operation.current;
    void window.platform
      .getBugWorkspace(projectId)
      .then((r) => {
        if (
          live &&
          currentScope.current === scope &&
          operation.current === request
        )
          setWorkspace({ ...unwrap(r), scope });
      })
      .catch((e) => {
        if (
          live &&
          currentScope.current === scope &&
          operation.current === request
        )
          setError(message(e));
      });
    return () => {
      live = false;
    };
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
  const allRefreshed =
    !!project?.issueBindings.length &&
    project.issueBindings.every(
      (binding) =>
        !unavailable(binding) && refreshes[binding.id]?.status === "success",
    );
  const refreshFailed = Object.values(refreshes).some(
    (state) => state.status === "failed",
  );
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
      if (valid()) setLoading(false);
    }
  }
  async function refreshBindings(bindingIds: string[]) {
    if (!project) return;
    const request = ++operation.current;
    const valid = () =>
      mounted.current &&
      currentScope.current === scope &&
      operation.current === request;
    const bindings = project.issueBindings.filter(
      (binding) => bindingIds.includes(binding.id) && !unavailable(binding),
    );
    setLoading(true);
    setError("");
    setNotice("");
    const failures: string[] = [];
    for (const binding of bindings) {
      setRefreshes((previous) => ({
        ...previous,
        [binding.id]: { ...previous[binding.id], status: "refreshing" },
      }));
      try {
        const fetched = unwrap(
          await window.platform.refreshIssues(projectId, binding.id),
        );
        if (!valid()) return;
        setWorkspace((previous) => ({
          scope,
          reports: previous.scope === scope ? previous.reports : [],
          issues: [
            ...(previous.scope === scope ? previous.issues : []).filter(
              (issue) => issue.bindingId !== binding.id,
            ),
            ...fetched,
          ],
        }));
        setRefreshes((previous) => ({
          ...previous,
          [binding.id]: { status: "success" },
        }));
      } catch (e) {
        if (!valid()) return;
        failures.push(
          `${binding.projectKey} · ${binding.owner}：${message(e)}`,
        );
        setRefreshes((previous) => ({
          ...previous,
          [binding.id]: { ...previous[binding.id], status: "failed" },
        }));
      }
    }
    if (!valid()) return;
    try {
      const next = unwrap(await window.platform.getBugWorkspace(projectId));
      if (!valid()) return;
      setWorkspace({ ...next, scope });
    } catch (e) {
      if (!valid()) return;
      failures.push(`读取本地问题和报告历史失败：${message(e)}`);
    }
    setError(failures.join("；"));
    setLoading(false);
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
            {unavailable(b) && (
              <p className="coverage-warning">{unavailable(b)}</p>
            )}
            {!unavailable(b) && (
              <p className="muted small">
                {refreshes[b.id]?.status === "success"
                  ? `刷新成功：${issues.filter((issue) => issue.bindingId === b.id).length} 条问题。`
                  : refreshes[b.id]?.status === "failed"
                    ? "刷新失败；显示的缓存仅代表上次读取的材料。"
                    : refreshes[b.id]?.status === "refreshing"
                      ? "正在刷新当前配置范围…"
                      : "此范围尚未刷新。"}
              </p>
            )}
            <div className="row-actions">
              <button
                className="secondary"
                disabled={busy || !project.enabled || !!unavailable(b)}
                onClick={() => void refreshBindings([b.id])}
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
                  void act(
                    async () => {
                      return unwrap(
                        await window.platform.readIssueByKey(
                          projectId,
                          b.id,
                          keys[b.id].trim(),
                        ),
                      );
                    },
                    "按编号读取完成；此范围展示本次单号结果，完整列表请刷新。",
                    () => {
                      setRefreshes((previous) => {
                        const next = { ...previous };
                        delete next[b.id];
                        return next;
                      });
                    },
                  )
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
        <div className="section-heading">
          <h2>范围内问题</h2>
          <button
            className="secondary"
            disabled={
              busy ||
              !project?.enabled ||
              !project.issueBindings.some((binding) => !unavailable(binding))
            }
            onClick={() =>
              void refreshBindings(
                project?.issueBindings.map((binding) => binding.id) ?? [],
              )
            }
          >
            刷新问题单
          </button>
        </div>
        {!allRefreshed && !refreshFailed && (
          <p className="muted">
            尚未刷新当前配置范围；缓存仅代表上次读取的材料。
          </p>
        )}
        {allRefreshed && issues.length === 0 && (
          <p className="muted">当前配置项目及负责人范围内无任何问题</p>
        )}
        {issues.map((issue) => (
          <article className="finding-card" key={issue.id}>
            <div className="section-heading">
              <h3>
                {project?.issueBindings.find(
                  (binding) => binding.id === issue.bindingId,
                )?.platform !== "trinity" && jiraLink(issue) ? (
                  <a
                    href={jiraLink(issue)!}
                    onClick={(event) => {
                      event.preventDefault();
                      void act(async () =>
                        unwrap(
                          await window.platform.openIssue(projectId, issue.id),
                        ),
                      );
                    }}
                  >
                    {issue.key}
                  </a>
                ) : (
                  <>
                    {issue.key}{" "}
                    <span className="muted small">（问题链接不可用）</span>
                  </>
                )}{" "}
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
              disabled={busy || !project?.enabled || !project?.aiProfileId}
              onClick={() =>
                void act(async () => {
                  unwrap(await window.platform.analyzeBug(projectId, issue.id));
                }, "预分析任务已加入队列，将重新校验问题并更新代码。")
              }
            >
              更新代码并预分析
            </button>
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
