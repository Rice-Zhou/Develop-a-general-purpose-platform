import { useState, type Dispatch, type SetStateAction } from "react";
import type { Project } from "../../../../../packages/contracts/src/models";
import { message, unwrap } from "../api";

type Documents = Project["documents"];
export function DocumentBindingsEditor({ documents, onChange, onError, disabled = false }: {
  documents: Documents;
  onChange: Dispatch<SetStateAction<Documents>>;
  onError: (error: string) => void;
  disabled?: boolean;
}) {
  const [choosing, setChoosing] = useState(false);
  function update(id: string, patch: Partial<Documents[number]>) {
    onChange(current => current.map(doc => doc.id === id ? { ...doc, ...patch } : doc));
  }
  async function choose() {
    setChoosing(true);
    onError("");
    try {
      const paths = unwrap(await window.platform.chooseDocumentFiles());
      onChange(current => [...current, ...paths.map(locator => ({ id: crypto.randomUUID(), kind: locator.toLowerCase().endsWith(".pdf") ? "pdf" as const : "docx" as const, locator, required: true }))]);
    } catch (error) { onError(message(error)); }
    finally { setChoosing(false); }
  }
  return <>
    <p className="muted small">本地 Word、PDF 将捕获为固定快照；飞书通过设置中的 CLI 只读获取。必需资料失败时任务会停止。</p>
    {!documents.length && <p className="empty-inline">当前项目尚未关联需求文档，可选择本地文件或添加飞书文档链接。</p>}
    {documents.map((doc, index) => <fieldset className="binding-form" aria-label={`需求文档 ${index + 1}`} key={doc.id} disabled={disabled || choosing}>
      <div className="form-row">
        <label>文档类型<select value={doc.kind} onChange={e => update(doc.id, { kind: e.target.value as Documents[number]["kind"] })}>
          <option value="docx">Word .docx</option><option value="pdf">PDF</option><option value="feishu">飞书文档</option>
        </select></label>
        <label className="grow">文档路径或链接<input required value={doc.locator} onChange={e => update(doc.id, { locator: e.target.value })} /></label>
        <button type="button" className="text-button danger-text" onClick={() => onChange(current => current.filter(item => item.id !== doc.id))}>删除文档</button>
      </div>
      <label className="check-label"><input type="checkbox" checked={doc.required} onChange={e => update(doc.id, { required: e.target.checked })} />必需文档（读取失败时停止分析）</label>
    </fieldset>)}
    <div className="row-actions">
      <button type="button" className="text-button" disabled={disabled || choosing} onClick={() => onChange(current => [...current, { id: crypto.randomUUID(), kind: "docx", locator: "", required: true }])}>＋ 关联文档</button>
      <button type="button" className="text-button" disabled={disabled || choosing} onClick={() => void choose()}>{choosing ? "正在选择文件…" : "从本机选择 Word / PDF"}</button>
    </div>
  </>;
}
