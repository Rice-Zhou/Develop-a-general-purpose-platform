import {useState} from "react";
import type {BugReportView,BugReportSummary} from "../../../../../packages/contracts/src/issues";
import {BugEvidenceItem} from "../components/BugEvidenceItem";
import {message,unwrap} from "../api";
export function BugReportPage({report:r,issue,context,onClose,versions=[],onSelectVersion,returnLabel="BUG 工作台"}:BugReportView&{onClose:()=>void;versions?:BugReportSummary[];onSelectVersion?:(id:string)=>void;returnLabel?:string}){
 const [error,setError]=useState(""),[notice,setNotice]=useState(""),[evidenceOpen,setEvidenceOpen]=useState(false),[selectedEvidence,setSelectedEvidence]=useState("");
 function evidenceLinks(ids:string[]){return ids.map(id=><button className="text-button" key={id} onClick={()=>{setEvidenceOpen(true);setSelectedEvidence(id);requestAnimationFrame(()=>document.getElementById(`bug-evidence-${id}`)?.scrollIntoView({block:"center"}));}}>{id}</button>);}
 return <section className="panel work-panel bug-report-page">
  <div className="section-heading"><div><span className="eyebrow">BUG PREANALYSIS</span><h2>BUG 预分析报告</h2></div><div className="row-actions"><button className="secondary" onClick={()=>void window.platform.exportBugReport(r.projectId,r.id).then(v=>{const path=unwrap(v);if(path)setNotice(`已导出到 ${path}`);}).catch(e=>setError(message(e)))}>导出 BUG Markdown</button><button className="text-button" onClick={onClose}>返回 {returnLabel}</button></div></div>
  {versions.length>1&&<label>报告版本<select value={r.id} onChange={e=>onSelectVersion?.(e.target.value)}>{versions.map(v=><option key={v.reportId} value={v.reportId}>{new Date(v.createdAt).toLocaleString()}</option>)}</select></label>}
  <h3>{issue.key} · {issue.title}</h3><p className="coverage-warning">静态预分析，未运行验证，候选原因未确认为根因。</p>
  {error&&<div className="error-panel" role="alert">{error}</div>}{notice&&<div className="notice">{notice}</div>}
  <h3>候选原因与排查步骤</h3>
  {!r.hypotheses.length&&<p className="muted">现有证据不足以提出候选原因，请展开缺失信息查看待补充材料。</p>}
  {r.hypotheses.map((h,i)=><article className="finding-card" key={i}><strong>{h.text}</strong><p className="small">支持证据：{h.supportEvidenceIds.length?evidenceLinks(h.supportEvidenceIds):"未取得"}<br/>反对证据：{h.counterEvidenceIds.length?evidenceLinks(h.counterEvidenceIds):"尚未取得，不代表无反例"}</p><ol>{h.nextSteps.map((s,j)=><li key={j}>{s}</li>)}</ol></article>)}
  <details><summary>复现条件</summary><ul>{r.reproduction.map((s,i)=><li key={i}>{s}</li>)}</ul></details>
  <details><summary>代码事实</summary>{r.facts.length?r.facts.map((f,i)=><p key={i}>{f.text}<br/>{evidenceLinks(f.evidenceIds)}</p>):<p className="muted">尚未取得充分代码事实。</p>}</details>
  <details><summary>缺失信息</summary><ul>{r.missingInformation.map((s,i)=><li key={i}>{s}</li>)}</ul></details>
  <details open={evidenceOpen} onToggle={e=>setEvidenceOpen(e.currentTarget.open)}><summary>固定版本证据</summary>{evidenceOpen&&r.evidenceRefs.map(e=><BugEvidenceItem key={`${r.id}:${e.id}`} projectId={r.projectId} contextId={r.contextSnapshotId} evidence={e} expanded={selectedEvidence===e.id}/>)}</details>
  <details><summary>检查范围与未解析材料</summary><ul>{[...r.checkedScope,...r.limitations].map((s,i)=><li key={i}>{s}</li>)}</ul></details>
  <details><summary>代码上下文与模型用量</summary><p className="muted">故障版本：{issue.versions.join("、")||"未提供"} · 问题快照 {issue.id.slice(0,8)} · {issue.updatedAt}</p>{context.repositories.map(repo=><p key={repo.bindingId} className="small">分析代码：{repo.branch??"detached / unborn"} @ <code>{repo.commit??"尚无提交"}</code>{repo.kind==="worktree"&&<> · 当前工作区 {repo.dirty?"包含未提交修改":"干净"} · 快照 <code>{repo.manifestHash}</code></>}</p>)}<p className="muted small">{r.executorConfiguration.name} · {r.executorConfiguration.configuredModel??"CLI 默认模型"} · {r.usage?`输入 ${r.usage.inputTokens} / 输出 ${r.usage.outputTokens} token`:"用量未知"}</p></details>
 </section>;
}
