import { useState } from "react";
import type { Project } from "../../../../../packages/contracts/src/models";
import type { IssueListItem } from "../../../../../packages/contracts/src/issue-monitor";
import { message, unwrap } from "../api";
export function TrinityIssueAssociationDialog({issue,projects,onClose,onSaved}:{issue:IssueListItem;projects:Project[];onClose:()=>void;onSaved:(project:Project)=>Promise<void>}) {
 const enabled=projects.filter(p=>p.enabled);
 const [targetId,setTargetId]=useState(enabled.find(p=>p.id===issue.projectId)?.id??enabled[0]?.id??"");
 const [busy,setBusy]=useState(false);const [error,setError]=useState("");
 async function save(){
  const target=enabled.find(p=>p.id===targetId);if(!target)return;
  setBusy(true);setError("");
  try{const saved=unwrap(await window.platform.associateTrinityIssue({projectId:issue.projectId,issueSnapshotId:issue.id,targetProjectId:target.id,expectedRevision:target.revision}));await onSaved(saved);}
  catch(e){setError(message(e));}
  finally{setBusy(false);}
 }
 return <div className="modal-backdrop"><section className="editor modal" role="dialog" aria-modal="true" aria-label="关联 Trinity 代码项目">
  <h2>关联代码项目</h2><p>{issue.key} · Trinity 项目：{issue.remoteProjectName??"未返回项目名称"}（{issue.remoteProjectId}）</p>
  <p className="muted">将此 Trinity 项目关联到所选代码项目，后续同项目问题自动使用此映射。已有其他关联会保留；保存不会启动 AI 分析。</p>
  <label>代码项目<select aria-label="代码项目" value={targetId} disabled={busy} onChange={e=>setTargetId(e.target.value)}>{enabled.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
  {!enabled.length&&<p className="coverage-warning">请先创建或启用代码项目。</p>}
  {error&&<div className="error-panel" role="alert">{error}</div>}
  <div className="form-footer"><button className="secondary" disabled={busy} onClick={onClose}>取消</button><button className="primary" disabled={busy||!targetId} onClick={()=>void save()}>{busy?"正在关联…":"保存关联"}</button></div>
 </section></div>;
}
