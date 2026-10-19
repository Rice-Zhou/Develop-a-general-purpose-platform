import { useState, type FormEvent } from "react";
import type { Project } from "../../../../../packages/contracts/src/models";
import { message, unwrap } from "../api";
import { DocumentBindingsEditor } from "./DocumentBindingsEditor";

export function ProjectDocumentsDialog({ project, onClose, onSaved }: {
  project: Project;
  onClose: () => void;
  onSaved: (project: Project) => void;
}) {
  const [documents, setDocuments] = useState(project.documents);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { onSaved(unwrap(await window.platform.saveProjectDocuments(project.id, documents, project.revision))); }
    catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  }
  return <div className="modal-backdrop">
    <section className="editor modal" role="dialog" aria-modal="true" aria-labelledby="project-documents-title">
      <div className="modal-heading"><div><h2 id="project-documents-title">管理需求文档</h2><p>{project.name}</p></div>
        <button type="button" className="icon-button" aria-label="关闭需求文档管理" disabled={busy} onClick={onClose}>×</button>
      </div>
      <form onSubmit={event => void save(event)}>
        <p className="muted small">删除仅解除当前项目的关联，不删除原始文件、飞书文档或历史快照。保存后请重新准备文档上下文，后续分析将使用最新配置。</p>
        <DocumentBindingsEditor documents={documents} onChange={setDocuments} onError={setError} disabled={busy} />
        {error && <div className="error-panel" role="alert">{error}</div>}
        <div className="form-footer">
          <button type="button" className="secondary" disabled={busy} onClick={onClose}>取消</button>
          <button className="primary" disabled={busy}>{busy ? "正在保存…" : "保存文档配置"}</button>
        </div>
      </form>
    </section>
  </div>;
}
