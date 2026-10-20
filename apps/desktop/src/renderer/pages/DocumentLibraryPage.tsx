import { useEffect, useState } from "react";
import type { DocumentResource, Project } from "../../../../../packages/contracts/src/models";
import { message, unwrap } from "../api";
import { DocumentResourceEditor } from "../components/DocumentResourceEditor";

export function DocumentLibraryPage({ projects, onChanged, onLink }: { projects: Project[]; onChanged: () => Promise<void>; onLink: (document: DocumentResource) => void }) {
  const [resources, setResources] = useState<DocumentResource[]>([]);
  const [editing, setEditing] = useState<DocumentResource | "new" | null>(null);
  const [error, setError] = useState("");
  async function reload() { setResources(unwrap(await window.platform.getDocumentResources())); }
  useEffect(() => { void reload().catch(e => setError(message(e))); }, [projects]);
  return <section className="panel work-panel">
    <div className="section-heading"><h2>需求资料库</h2><button className="primary" onClick={() => setEditing("new")}>添加需求文档资源</button></div>
    <p className="muted">需求文档可独立配置，随后关联一个或多个代码项目。删除资源需先解除关联，不删除原文与历史分析。</p>
    {error && <div className="error-panel" role="alert">{error}</div>}
    {!resources.length && <p className="empty-inline">尚未配置需求文档资源。</p>}
    {resources.map(resource => <div className="report-list-item" key={resource.id}><div><strong>{resource.name}</strong><p className="muted small">{resource.kind} · {resource.locator}</p><p className="muted small">关联项目：{projects.filter(p => p.documents.some(d => d.id === resource.id)).map(p => p.name).join("、") || "未关联"}</p></div><div className="row-actions">
      <button className="secondary" onClick={() => onLink(resource)}>关联项目</button><button className="text-button" onClick={() => setEditing(resource)}>编辑资源</button><button className="text-button danger-text" onClick={() => { setError(""); void window.platform.deleteDocumentResource(resource.id, resource.revision).then(unwrap).then(reload).catch(e => setError(message(e))); }}>删除资源</button>
    </div></div>)}
    {editing && <DocumentResourceEditor resource={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload().then(onChanged).catch(e => setError(message(e))); }} />}
  </section>;
}
