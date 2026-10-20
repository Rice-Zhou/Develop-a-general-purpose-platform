import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { DocumentResource, Project } from "../../../../../packages/contracts/src/models";
import { message, unwrap } from "../api";
import { DocumentResourceEditor } from "./DocumentResourceEditor";

export function DocumentResourcePicker({ documents, onChange, onError, disabled = false }: { documents: Project["documents"]; onChange: Dispatch<SetStateAction<Project["documents"]>>; onError: (message: string) => void; disabled?: boolean }) {
  const [resources, setResources] = useState<DocumentResource[]>([]);
  const [adding, setAdding] = useState(false); const [picking, setPicking] = useState(false);
  useEffect(() => { let alive = true; void window.platform.getDocumentResources().then(r => { if (alive) setResources(unwrap(r)); }).catch(error => { if (alive) onError(message(error)); }); return () => { alive = false; }; }, []);
  function add(resource: DocumentResource) {
    setResources(current => current.some(r => r.id === resource.id) ? current.map(r => r.id === resource.id ? resource : r) : [...current, resource]);
    onChange(current => [...current.filter(d => d.id !== resource.id), { id: resource.id, kind: resource.kind, locator: resource.locator, required: resource.required }]);
  }
  async function chooseFiles() {
    setPicking(true); onError("");
    try {
      const paths = unwrap(await window.platform.chooseDocumentFiles());
      for (const locator of paths) add(unwrap(await window.platform.saveDocumentResource({ name: locator.split(/[\\/]/).at(-1) || locator, locator, kind: locator.toLowerCase().endsWith(".pdf") ? "pdf" : "docx", required: true })));
    } catch (error) { onError(message(error)); } finally { setPicking(false); }
  }
  return <>
    <p className="muted small">从资料库勾选需求文档，保存后与当前项目关联。解除关联不删除资源和原文。</p>
    {!resources.length && <p className="empty-inline">资料库暂无文档，可先添加需求文档资源。</p>}
    {resources.map(resource => {
      const selected = documents.find(d => d.id === resource.id);
      return <div className="binding-form" key={resource.id}>
        <label className="check-label"><input type="checkbox" disabled={disabled || picking} checked={Boolean(selected)} onChange={e => {
          if (e.target.checked) add(resource); else onChange(current => current.filter(d => d.id !== resource.id));
        }} />{resource.name}</label>
        <p className="muted small">{resource.kind} · {resource.locator}</p>
        {selected && <label className="check-label"><input type="checkbox" disabled={disabled || picking} checked={selected.required} onChange={e => onChange(current => current.map(d => d.id === resource.id ? { ...d, required: e.target.checked } : d))} />本项目必需文档</label>}
      </div>;
    })}
    <div className="row-actions"><button type="button" className="secondary" disabled={disabled || picking} onClick={() => setAdding(true)}>添加需求文档资源</button><button type="button" className="text-button" disabled={disabled || picking} onClick={() => void chooseFiles()}>从本机添加 Word / PDF</button></div>
    {adding && <DocumentResourceEditor onClose={() => setAdding(false)} onSaved={resource => { add(resource); setAdding(false); }} />}
  </>;
}
