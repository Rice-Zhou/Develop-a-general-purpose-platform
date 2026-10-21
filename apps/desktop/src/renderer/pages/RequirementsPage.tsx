import {RequirementReviewList} from "../components/RequirementReviewList";
import type {RequirementReviewView} from "../../../../../packages/contracts/src/requirement-review";
import type {PublicAIProfile} from "../../../../../packages/contracts/src/analysis";
import { useEffect, useRef, useState } from "react";
import type {
  DesktopAPI,
  Project,
  Task,
} from "../../../../../packages/contracts/src/models";
import type { RequirementItem } from "../../../../../packages/contracts/src/requirements";
import type {
  DocumentSnapshot,
  DocumentBlock,
} from "../../../../../packages/contracts/src/documents";
import { unwrap, message } from "../api";
import { DocumentsPage } from "./DocumentsPage";
import { ReportPage } from "./ReportPage";
import { ProjectDocumentsDialog } from "../components/ProjectDocumentsDialog";
type Workspace = Extract<
  Awaited<ReturnType<DesktopAPI["getWorkspace"]>>,
  { ok: true }
>["value"];
export function RequirementsPage({
  projects,
  tasks,
  onChanged,
  onSettings,
}: {
  projects: Project[];
  tasks: Task[];
  onChanged: () => Promise<void>;
  onSettings?:()=>void;
}) {
  const [projectId, setProjectId] = useState("");
  const [managingDocuments, setManagingDocuments] = useState<Project | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [items, setItems] = useState<RequirementItem[]>([]);
  const [error, setError] = useState("");
  const [noticeState,setNoticeState]=useState({projectId:"",text:""});
  const notice=noticeState.projectId===projectId?noticeState.text:"";
  function setNotice(text:string){if(projectEpoch.current===renderEpoch)setNoticeState({projectId,text});}
  const [reviews,setReviews]=useState<RequirementReviewView[]>([]);
  const [profiles,setProfiles]=useState<PublicAIProfile[]>([]);
  const [operationTaskId,setOperationTaskId]=useState("");
  const currentProject=useRef(projectId);const projectEpoch=useRef(0);
  if(currentProject.current!==projectId){currentProject.current=projectId;projectEpoch.current++;}
  const renderEpoch=projectEpoch.current;
  useEffect(()=>{let alive=true;void window.platform.getAIProfiles().then(unwrap).then(p=>{if(alive)setProfiles(p);}).catch(e=>{if(alive)setError(message(e));});return()=>{alive=false;};},[projects]);
  const [requesting, setRequesting] = useState(false);
  const [reportId, setReportId] = useState<string | null>(null);
  const [reportDetail, setReportDetail] = useState<Extract<Awaited<ReturnType<DesktopAPI["getReport"]>>, {ok: true}>["value"] | null>(null);
  useEffect(() => {
    setReportDetail(null);
    if (!reportId || !projectId) return;
    let alive = true;
    void window.platform.getReport(projectId, reportId).then(result => {
      const detail = unwrap(result);
      if (alive) setReportDetail(detail);
    }).catch(e => { if (alive) setError(message(e)); });
    return () => { alive = false; };
  }, [projectId, reportId]);
  const completedTaskId =
    tasks.find((t) => t.projectId === projectId && ["PREPARE_CONTEXT","EXTRACT_REQUIREMENTS","CHECK_REQUIREMENTS","AUDIT_REQUIREMENTS"].includes(t.kind) && t.status === "SUCCEEDED")
      ?.id ?? "";
  useEffect(() => {
    if (!projects.some((p) => p.id === projectId))
      setProjectId(projects[0]?.id ?? "");
  }, [projects, projectId]);
  useEffect(() => {
    setWorkspace(null);
    setReviews([]);
    setOperationTaskId("");
    setRequesting(false);
    setManagingDocuments(null);
    setReportId(null);
    setItems([]);
    setError("");
  }, [projectId]);
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    const load = async () => {
      try {
        const [w,r]=await Promise.all([window.platform.getWorkspace(projectId),window.platform.getRequirementReviews(projectId)]);
        if(alive){setWorkspace(unwrap(w));setReviews(unwrap(r));}
      } catch (e) {
        if (alive) setError(message(e));
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, [projectId, completedTaskId]);
  useEffect(() => {
    setItems(workspace?.requirements?.items ?? []);
  }, [workspace?.requirements?.id]);
  const project = projects.find((p) => p.id === projectId);
  const active = tasks.some(
    (t) =>
      t.projectId === projectId &&
      ["QUEUED", "PREPARING", "RUNNING", "VALIDATING", "CANCELLING"].includes(
        t.status,
      ),
  );
  const busy = requesting || active;
  const latestTask=tasks.find(t=>t.id===operationTaskId&&t.projectId===projectId);
  const profile=profiles.find(p=>p.id===project?.aiProfileId);
  const aiReason=!project?.enabled?"项目已停用":!profile?"请先配置有效 AI 连接":!profile.outboundEnabled?"请先允许 AI 读取项目材料":"";
  async function reloadReviews(){const epoch=projectEpoch.current;const r=unwrap(await window.platform.getRequirementReviews(projectId));if(projectEpoch.current===epoch)setReviews(r);}
  async function act(action: () => Promise<void>) {
    const epoch=projectEpoch.current;
    setError("");
    setNotice("");
    setRequesting(true);
    try {
      await action();
      await onChanged();
      if(projectId&&projectEpoch.current===epoch){const value=unwrap(await window.platform.getWorkspace(projectId));if(projectEpoch.current===epoch)setWorkspace(value);}
    } catch (e) {
      if(projectEpoch.current===epoch)setError(message(e));
    } finally {
      if(projectEpoch.current===epoch)setRequesting(false);
    }
  }
  async function add(document: DocumentSnapshot, block: DocumentBlock) {
    if (!workspace?.context) return;
    await act(async () => {
      const source = unwrap(
        await window.platform.readDocumentBlock(
          projectId,
          workspace.context!.id,
          document.id,
          block.id,
        ),
      );
      if(projectEpoch.current!==renderEpoch)return;
      setItems((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          text: block.text,
          acceptanceCriteria: [],
          sourceRefs: [
            {
              documentSnapshotId: document.id,
              blockId: block.id,
              quoteHash: source.evidence.quoteHash,
            },
          ],
          clarification: "请补充可检验的验收条件",
          reviewed: false,
        },
      ]);
      setNotice("已加入草稿，请补充验收条件并保存需求版本。");
    });
  }
  if (reportDetail && reportDetail.report.id === reportId && reportDetail.report.projectId === projectId)
    return (
      <ReportPage
        key={reportDetail.report.id}
        report={reportDetail.report}
        items={reportDetail.requirements.items}
        onClose={() => setReportId(null)}
      />
    );
  return (
    <div className="workspace-stack">
      <section className="panel work-panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">REQUIREMENT WORKSPACE</span>
            <h2>项目需求与原文</h2>
          </div>
          <label className="project-selector">
            当前项目
            <select
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
        {!project ? (
          <p className="muted">请先添加项目，关联独立代码目录与需求文档。</p>
        ) : (
          <>
            <p className="muted">
              {workspace?.context
                ? `固定上下文 ${workspace.context.id.slice(0, 8)} · ${new Date(workspace.context.createdAt).toLocaleString()}`
                : "尚未审核。审核读取当前代码（含未提交修改）和关联需求，不自动更新代码。"}{" "}
              ·{" "}
              {project.aiProfileId
                ? "已关联 AI 连接"
                : "未关联 AI，可阅读原文并人工建立需求"}
            </p>
            <div className="row-actions">              <button className="secondary" disabled={busy} onClick={() => setManagingDocuments(project)}>管理需求文档</button>
              <span className="tag">已关联 {project.documents.length} 份需求文档</span>
<button className="primary" disabled={busy||Boolean(aiReason)} title={aiReason||"审核当前工作区"} onClick={()=>void act(async()=>{const t=unwrap(await window.platform.auditRequirements(projectId));if(projectEpoch.current===renderEpoch)setOperationTaskId(t.id);setNotice("需求审核已加入任务列表。");})}>AI 审核当前代码</button><span className="muted small">{profile?`当前 AI：${profile.name} · ${profile.model}`:aiReason}</span>{aiReason&&<button className="text-button" onClick={onSettings}>配置 AI 连接</button>}</div>
            <details><summary>原文准备与独立提取（可选）</summary><div className="row-actions">
              <button
                className="primary"
                disabled={busy || !project.enabled}
                onClick={() =>
                  void act(async () => {
                    unwrap(await window.platform.prepareContext(projectId));
                    setNotice("上下文任务已加入队列。");
                  })
                }
              >
                准备文档上下文
              </button>
              <button
                className="secondary"
                disabled={busy || !project.enabled || !project.aiProfileId}
                onClick={() =>
                  void act(async () => {
                    unwrap(
                      await window.platform.extractRequirements(projectId),
                    );
                    setNotice(
                      "需求提取任务已加入队列，读取当前代码与文档。",
                    );
                  })
                }
              >
                AI 提取需求
              </button>
              <button
                className="secondary"
                disabled={
                  busy ||
                  !project.enabled ||
                  !project.aiProfileId ||
                  !workspace?.requirements?.items.length
                }
                onClick={() =>
                  void act(async () => {
                    unwrap(
                      await window.platform.checkRequirements(
                        projectId,
                        workspace!.requirements!.id,
                      ),
                    );
                    setNotice("核对任务已加入队列，报告只引用本次固定上下文。");
                  })
                }
              >
                开始实现核对
              </button>
            </div></details>
          </>
        )}
        {active && (
          <div className="notice">
            本项目正在执行任务。阶段与失败原因可在任务列表查看。
          </div>
        )}
        {error && (
          <div className="error-panel" role="alert">
            {error}
          </div>
        )}
        {latestTask?.error && (
          <div className="error-panel" role="alert">
            {latestTask.error.code}：{latestTask.error.message}
          </div>
        )}
        {notice && <div className="notice">{notice}</div>}
        {workspace?.context?.sourceGaps?.map((gap) => (
          <div className="coverage-warning" key={gap.bindingId}>
            缺失资料：{gap.message}
          </div>
        ))}
      </section>
      {managingDocuments && <ProjectDocumentsDialog project={managingDocuments} onClose={() => setManagingDocuments(null)} onSaved={() => {
        setManagingDocuments(null);
        setNotice("需求文档配置已保存，可重新审核当前代码与需求。历史快照与报告保持不变。");
        void onChanged().catch(error => setError(message(error)));
      }} />}
      {project&&<RequirementReviewList key={projectId} items={reviews} onChanged={reloadReviews} onOpenReport={setReportId}/>}
      {workspace?.reports[0]?.findings.some(f=>f.status==="UNKNOWN"||f.status==="CONFLICT")&&<details className="panel work-panel"><summary>信息不足 / 需求待澄清</summary>{workspace.reports[0].findings.filter(f=>f.status==="UNKNOWN"||f.status==="CONFLICT").map(f=><p key={f.requirementId}>{workspace.requirements?.items.find(i=>i.id===f.requirementId)?.text}：{f.explanation}</p>)}</details>}
      {workspace?.context && (
        <details><summary>原文、人工修订与报告历史</summary><div className="requirements-layout">
          <DocumentsPage
            key={workspace.context.id}
            projectId={projectId}
            contextId={workspace.context.id}
            documents={workspace.documents}
            onAdd={(document, block) => void add(document, block)}
          />
          <div className="workspace-stack">
            <section className="panel work-panel">
              <div className="section-heading">
                <h2>可核对需求</h2>
                <span className="tag">
                  {workspace.requirements
                    ? `需求版本 ${workspace.requirements.revision}`
                    : "未保存草稿"}
                </span>
              </div>
              <p className="muted small">
                从原文加入需求，或通过 AI 提取后复核。修订会保留旧版本与来源。
              </p>
              {items.length === 0 && (
                <p className="empty-inline">
                  从左侧原文点击“加入需求”，开始建立需求清单。
                </p>
              )}
              {items.map((item, index) => (
                <article className="requirement-editor" key={item.id}>
                  <div className="section-heading">
                    <span className="eyebrow">REQUIREMENT {index + 1}</span>
                    <button
                      className="text-button danger-text"
                      disabled={busy}
                      onClick={() =>
                        setItems(items.filter((i) => i.id !== item.id))
                      }
                    >
                      移除需求
                    </button>
                  </div>
                  <label>
                    需求描述
                    <input
                      aria-label={`需求描述 ${index + 1}`}
                      value={item.text}
                      onChange={(e) =>
                        setItems(
                          items.map((i) =>
                            i.id === item.id
                              ? { ...i, text: e.target.value }
                              : i,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    验收条件（每行一项）
                    <textarea
                      aria-label={`验收条件 ${index + 1}`}
                      value={item.acceptanceCriteria.join("\n")}
                      onChange={(e) =>
                        setItems(
                          items.map((i) =>
                            i.id === item.id
                              ? {
                                  ...i,
                                  acceptanceCriteria: e.target.value
                                    .split("\n")
                                    .filter((line) => line.trim()),
                                }
                              : i,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    待澄清内容
                    <input
                      value={item.clarification}
                      onChange={(e) =>
                        setItems(
                          items.map((i) =>
                            i.id === item.id
                              ? { ...i, clarification: e.target.value }
                              : i,
                          ),
                        )
                      }
                    />
                  </label>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={item.reviewed}
                      onChange={(e) =>
                        setItems(
                          items.map((i) =>
                            i.id === item.id
                              ? { ...i, reviewed: e.target.checked }
                              : i,
                          ),
                        )
                      }
                    />
                    我已核对需求与原文
                  </label>
                  <p className="muted small">
                    {item.sourceRefs.length} 处原文依据，锚点将在保存时验证
                  </p>
                </article>
              ))}
              <button
                className="primary"
                disabled={busy || !workspace.context}
                onClick={() =>
                  void act(async () => {
                    unwrap(
                      await window.platform.saveRequirementRevision(
                        projectId,
                        workspace.context!.id,
                        items,
                        workspace.requirements?.revision ?? 0,
                      ),
                    );
                    setNotice("新需求版本已保存，历史版本保持不变。");
                  })
                }
              >
                保存需求版本
              </button>
            </section>
            <section className="panel work-panel">
              <h2>核对报告历史</h2>
              {workspace.reports.length === 0 ? (
                <p className="muted">
                  尚未产生成功报告。模型失败、取消或证据校验失败不会产生成功报告。
                </p>
              ) : (
                workspace.reports.map((report) => (
                  <div className="report-list-item" key={report.id}>
                    <div>
                      <strong>
                        {new Date(report.createdAt).toLocaleString()}
                      </strong>
                      <p className="muted small">
                        {report.findings.length} 项 · 静态分析 ·{" "}
                        {report.contextSnapshotId.slice(0, 8)}
                      </p>
                    </div>
                    <button
                      className="secondary"
                      onClick={() => setReportId(report.id)}
                    >
                      查看报告
                    </button>
                  </div>
                ))
              )}
            </section>
          </div>
        </div></details>
      )}
    </div>
  );
}
