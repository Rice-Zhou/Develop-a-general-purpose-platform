import { useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import type { DocumentResource } from "../../../../../packages/contracts/src/models";
import { message, unwrap } from "../api";

export function DocumentResourceEditor({ resource, onSaved, onClose }: { resource?: DocumentResource; onSaved: (resource: DocumentResource) => void; onClose: () => void }) {
  const [name, setName] = useState(resource?.name ?? "");
  const [kind, setKind] = useState<DocumentResource["kind"]>(resource?.kind ?? "docx");
  const [locator, setLocator] = useState(resource?.locator ?? "");
  const [required, setRequired] = useState(resource?.required ?? true);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function save(event: FormEvent) {
    event.preventDefault(); event.stopPropagation(); setBusy(true); setError("");
    try { onSaved(unwrap(await window.platform.saveDocumentResource({ ...(resource ? { id: resource.id } : {}), name, kind, locator, required }, resource?.revision))); }
    catch (error) { setError(message(error)); } finally { setBusy(false); }
  }
  return createPortal(<div className="modal-backdrop"><section className="editor modal" role="dialog" aria-modal="true" aria-labelledby="document-resource-title">
    <h2 id="document-resource-title">{resource ? "编辑需求文档资源" : "添加需求文档资源"}</h2>
    <form onSubmit={event => void save(event)}>
      <label>需求文档名称<input required value={name} onChange={e => setName(e.target.value)} /></label>
      <label>文档类型<select value={kind} onChange={e => setKind(e.target.value as typeof kind)}><option value="docx">Word .docx</option><option value="pdf">PDF</option><option value="feishu">飞书文档</option></select></label>
      <label>文档路径或链接<input required value={locator} onChange={e => setLocator(e.target.value)} /></label>
      <label className="check-label"><input type="checkbox" checked={required} onChange={e => setRequired(e.target.checked)} />默认作为必需文档</label>
      <p className="muted small">可先保存再关联项目。修改资源会应用到所有关联项目，历史快照保持不变。</p>
      {error && <div className="error-panel" role="alert">{error}</div>}
      <div className="form-footer"><button type="button" className="secondary" disabled={busy} onClick={onClose}>取消</button><button className="primary" disabled={busy}>保存需求文档资源</button></div>
    </form>
  </section></div>, document.body);
}
