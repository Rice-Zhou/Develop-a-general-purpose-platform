import type {LibraryResource} from "../../../../../packages/contracts/src/library";
import { useEffect, useState, type FormEvent } from "react";
import type { Project } from "../../../../../packages/contracts/src/models";
import { message, unwrap } from "../api";
import { DocumentResourcePicker } from "./DocumentResourcePicker";

export function ProjectDocumentsDialog({ project, onClose, onSaved, initialDocument }: {
  initialDocument?: Project["documents"][number];
  project: Project;
  onClose: () => void;
  onSaved: (project: Project) => void;
}) {
  const [documents, setDocuments] = useState(initialDocument && !project.documents.some(d => d.id === initialDocument.id) ? [...project.documents, { id: initialDocument.id, kind: initialDocument.kind, locator: initialDocument.locator, required: initialDocument.required }] : project.documents);
  const [resources,setResources]=useState<LibraryResource[]>([]);
  const [references,setReferences]=useState((project.resourceLinks??[]).filter(l=>l.role==="reference").map(l=>l.resourceId));
  useEffect(()=>{let active=true;void window.platform.getLibrary().then(unwrap).then(l=>{if(active)setResources(l.resources);}).catch(e=>{if(active)setError(message(e));});return()=>{active=false;};},[]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { onSaved(unwrap(await window.platform.saveProjectResources(project.id,[...documents.map(d=>({resourceId:d.id,role:"requirement" as const,required:d.required})),...references.filter(id=>!documents.some(d=>d.id===id)).map(resourceId=>({resourceId,role:"reference" as const,required:false}))],project.revision))); }
    catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  }
  return <div className="modal-backdrop">
    <section className="editor modal" role="dialog" aria-modal="true" aria-labelledby="project-documents-title">
      <div className="modal-heading"><div><h2 id="project-documents-title">管理需求文档</h2><p>{project.name}</p></div>
        <button type="button" className="icon-button" aria-label="关闭需求文档管理" disabled={busy} onClick={onClose}>×</button>
      </div>
      <form onSubmit={event => void save(event)}>
        <p className="muted small">删除仅解除当前项目的关联，不删除原始文件、飞书文档或历史快照。后续审核将读取当前代码与最新需求。</p>
        <DocumentResourcePicker documents={documents} onChange={setDocuments} onError={setError} disabled={busy} />
        <details><summary>参考资料关联</summary>{resources.filter(r=>!documents.some(d=>d.id===r.id)).map(r=><label className="check-label" key={r.id}><input type="checkbox" checked={references.includes(r.id)} onChange={e=>setReferences(v=>e.target.checked?[...v,r.id]:v.filter(id=>id!==r.id))}/>{r.name}（参考）</label>)}</details>
        {error && <div className="error-panel" role="alert">{error}</div>}
        <div className="form-footer">
          <button type="button" className="secondary" disabled={busy} onClick={onClose}>取消</button>
          <button className="primary" disabled={busy}>{busy ? "正在保存…" : "保存文档配置"}</button>
        </div>
      </form>
    </section>
  </div>;
}
