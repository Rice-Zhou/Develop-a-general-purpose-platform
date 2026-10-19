import { useEffect, useState } from "react";
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
type Workspace = Extract<
  Awaited<ReturnType<DesktopAPI["getWorkspace"]>>,
  { ok: true }
>["value"];
export function RequirementsPage({
  projects,
  tasks,
  onChanged,
}: {
  projects: Project[];
  tasks: Task[];
  onChanged: () => Promise<void>;
}) {
  const [projectId, setProjectId] = useState("");
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [items, setItems] = useState<RequirementItem[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [reportId, setReportId] = useState<string | null>(null);
  const completedTaskId =
    tasks.find((t) => t.projectId === projectId && t.status === "SUCCEEDED")
      ?.id ?? "";
  useEffect(() => {
    if (!projects.some((p) => p.id === projectId))
      setProjectId(projects[0]?.id ?? "");
  }, [projects, projectId]);
  useEffect(() => {
    setWorkspace(null);
    setReportId(null);
    setItems([]);
    setError("");
  }, [projectId]);
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    const load = async () => {
      try {
        const value = unwrap(await window.platform.getWorkspace(projectId));
        if (alive) setWorkspace(value);
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
  const latestTask = tasks.find((task) => task.projectId === projectId);
  async function act(action: () => Promise<void>) {
    setError("");
    setNotice("");
    setRequesting(true);
    try {
      await action();
      await onChanged();
      if (projectId)
        setWorkspace(unwrap(await window.platform.getWorkspace(projectId)));
    } catch (e) {
      setError(message(e));
    } finally {
      setRequesting(false);
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
  const selectedReport = workspace?.reports.find((r) => r.id === reportId);
  if (selectedReport)
    return (
      <ReportPage
        key={selectedReport.id}
        report={selectedReport}
        items={workspace?.requirements?.items ?? []}
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
                : "尚未准备上下文。准备时先安全同步代码，再捕获文档。"}{" "}
              ·{" "}
              {project.aiProfileId
                ? "已关联 AI 连接"
                : "未关联 AI，可阅读原文并人工建立需求"}
            </p>
            <div className="row-actions">
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
                      "需求提取任务已加入队列，每次重新同步代码和文档。",
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
            </div>
          </>
        )}
        {active && (
          <div className="notice">
            本项目正在执行任务。阶段与失败原因可在任务历史查看。
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
      {workspace?.context && (
        <div className="requirements-layout">
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
        </div>
      )}
    </div>
  );
}
