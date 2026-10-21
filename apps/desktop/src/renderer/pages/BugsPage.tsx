import {ACTIVE_TASK_STATUSES} from "../../../../../packages/contracts/src/models";
import {IssueLogMaterials} from "../components/IssueLogMaterials";
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
import { TrinityIssueAssociationDialog } from "../components/TrinityIssueAssociationDialog";
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
  onViewTasks,
}: {
  projects: Project[];
  tasks: Task[];
  onChanged: () => Promise<void>;
  onConfigureAI: () => void;
  onEditProject: (project: Project) => void;
  onViewTasks: (filter:{projectId?:string;issueIdentity?:string})=>void;
}) {
  const [projectId, setProjectId] = useState("");
  const [workspace, setWorkspace] = useState<{
    scope: string;
    issues: IssueListItem[];
    sources: IssueSourceState[];
    reports: BugReport[];
  }>({ scope: "", issues: [], reports: [], sources: [] });
  const [logPreview,setLogPreview]=useState<string>();
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [associating,setAssociating]=useState<IssueListItem|null>(null);
  const [analysisTargets,setAnalysisTargets]=useState<Record<string,string>>({});
  const submitting = useRef(new Set<string>());
  const [submittingKeys, setSubmittingKeys] = useState<string[]>([]);
  const foreground = useRef(false);
  const project = projects.find((p) => p.id === projectId);
  const scope = JSON.stringify([
    project?.id,
    project?.enabled,
    project?.issueBindings,
    projects.map(p=>[p.id,p.enabled,p.trinityProjects,p.aiProfileId]),
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
    setAnalysisTargets({});
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
  const busy = loading;
  const active=tasks.some(t=>t.projectId===projectId&&["QUEUED","PREPARING","RUNNING","VALIDATING","CANCELLING"].includes(t.status));
  const targetIdFor=(issue:IssueListItem)=>analysisTargets[issue.id]||issue.analysisProjectId;
  const analysisKeyFor = (issue: IssueListItem) => `${targetIdFor(issue) ?? projectId}:${issue.bindingId}:${issue.remoteId}`;
  const analysisTaskFor = (issue: IssueListItem) => tasks.find(task =>
    task.kind === "ANALYZE_BUG" && task.projectId === (targetIdFor(issue) ?? projectId) &&
    task.issueIdentity === `${issue.bindingId}:${issue.remoteId}` && ACTIVE_TASK_STATUSES.includes(task.status));
  const unavailableFor = (issue: IssueListItem): string => {
    const selected=analysisTargets[issue.id];
    if(selected&&!issue.analysisProjects?.some(p=>p.id===selected))return "所选代码项目的映射已变化，请重新选择。";
    if(!selected&&issue.analysisUnavailable)return issue.analysisUnavailable;
    const target=projects.find(p=>p.id===(targetIdFor(issue)??projectId));
    if(!target?.enabled)return "预分析不可用：匹配的代码项目已停用。";
    if(submittingKeys.includes(analysisKeyFor(issue)))return "该问题正在提交预分析任务，请勿重复提交。";
    if(analysisTaskFor(issue))return "该问题已有预分析任务，可在任务列表查看或取消。";
    if(!target.aiProfileId)return "预分析不可用：匹配的代码项目未配置可用 AI 执行连接。";
    return "";
  };
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
  async function analyze(issue: IssueListItem, codeOnly = false) {
    const key = analysisKeyFor(issue);
    if (submitting.current.has(key) || unavailableFor(issue)) return;
    submitting.current.add(key);
    setSubmittingKeys([...submitting.current]);
    setError("");
    setNotice("");
    const valid = () => mounted.current && currentScope.current === scope;
    try {
      unwrap(await window.platform.analyzeBug({projectId, issueSnapshotId: issue.id,
        targetProjectId: targetIdFor(issue), ...(codeOnly ? {options: {logPolicy: "code-only" as const}} : {})}));
      await onChanged();
      if (valid()) setNotice(codeOnly ? "已明确跳过日志，任务将只使用当前代码和问题描述。" :
        "预分析任务已加入队列，将等待独立日志下载完成，再使用当前代码预分析。");
    } catch (e) {
      if (valid()) setError(message(e));
    } finally {
      submitting.current.delete(key);
      if (mounted.current) setSubmittingKeys([...submitting.current]);
    }
  }
  if (detail && detail.report.projectId === projectId)
    return <BugReportPage {...detail} onClose={() => setDetail(null)} />;
  return (
    <div className="workspace-stack">
      {associating&&<TrinityIssueAssociationDialog issue={associating} projects={projects} onClose={()=>setAssociating(null)} onSaved={async saved=>{await onChanged();setAssociating(null);setProjectId(saved.id);setNotice(`已关联代码项目“${saved.name}”，可点击基于当前代码预分析。`);}} />}
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
          只读操作，Jira 限制配置项目与负责人，Trinity 读取当前登录账号的问题。分析前重新读取
          BUG、准备日志并固定当前工作区（含未提交修改），不会自动更新代码。所有已配置来源统一读取和展示。
          Jira 展示除完成状态外的所有问题。
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
            任务正在队列中执行，可在任务列表取消或查看步骤。
          </div>
        )}
        {project && !project.aiProfileId && (
          <div className="notice">
            <p>当前项目尚无可用 AI。配置默认 AI 后，代码、需求和 BUG 预分析会共同使用；项目覆盖请在项目管理中设置。</p>
            <div className="row-actions">
              <button className="secondary" onClick={onConfigureAI}>配置 AI 连接</button>

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
        <p className="muted small">Trinity 显示当前账号的问题，预分析按明确的代码项目映射执行。一次获取当前项目全部来源，无需切换平台。某个来源失败时，其余来源仍正常展示；失败来源的缓存仅代表上次读取的材料。</p>
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
        {logPreview!==undefined&&<div className="evidence-reader"><button className="secondary" onClick={()=>setLogPreview(undefined)}>关闭日志预览</button><pre>{logPreview}</pre></div>}
        {issues.map((issue) => { const analysisUnavailable=unavailableFor(issue); const analysisTask=analysisTaskFor(issue); const analysisLabel=submittingKeys.includes(analysisKeyFor(issue))?"提交中":analysisTask?.status==="QUEUED"?"排队中":analysisTask?.status==="CANCELLING"?"取消中":analysisTask?"分析中":"基于当前代码预分析"; const analysisProjectName=projects.find(p=>p.id===targetIdFor(issue))?.name; return (
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
              来源项目：{issue.remoteProjectName ? `${issue.remoteProjectName}（${issue.remoteProjectId}）` : issue.remoteProjectId} · {analysisProjectName ? `匹配代码项目：${analysisProjectName} · ` : ""}{issue.ownerId} · 问题版本 {issue.versions.join("、") || "未提供"}{" "}
              · 更新 {issue.updatedAt}
            </p>
            <IssueLogMaterials issue={issue} projectId={projectId} busy={busy} onAction={act} onPreview={setLogPreview} />
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
            {issue.analysisProjects&&<div className="row-actions trinity-analysis-actions">
              {issue.analysisProjects.length>1&&<label>预分析代码项目<select aria-label="预分析代码项目" value={targetIdFor(issue)??""} disabled={loading} onChange={e=>setAnalysisTargets(previous=>({...previous,[issue.id]:e.target.value}))}>
                <option value="">请选择已关联的代码项目</option>{issue.analysisProjects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
              </select></label>}
              <button className="secondary" disabled={loading} onClick={()=>setAssociating(issue)}>关联代码项目</button>
            </div>}
            <button
              className="primary"
              disabled={!!analysisUnavailable}
              title={analysisUnavailable || undefined}
              aria-describedby={analysisUnavailable ? `analysis-reason-${issue.id}` : undefined}
              onClick={() => void analyze(issue)}
            >
              {analysisLabel}
            </button>
            <button className="secondary" disabled={!!analysisUnavailable} onClick={()=>void analyze(issue,true)}>仅按代码和问题描述分析</button>
            <button className="text-button" onClick={()=>onViewTasks({projectId:targetIdFor(issue)??projectId,issueIdentity:`${issue.bindingId}:${issue.remoteId}`})}>查看任务</button>
            {analysisUnavailable && (
              <p id={`analysis-reason-${issue.id}`} className="coverage-warning">{analysisUnavailable}</p>
            )}
          </article>
        );})}
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
