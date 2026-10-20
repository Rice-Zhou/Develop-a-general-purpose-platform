import { useEffect, useState } from "react";
import type { Project, Task } from "../../../../../packages/contracts/src/models";
import { message, unwrap } from "../api";

export function CodeConflictDialog({ project, task, onClose, onQueued }: { project: Project; task: Task; onClose: () => void; onQueued: () => void }) {
  const [manual, setManual] = useState(false);
  const [reason, setReason] = useState("正在检查 AI 配置…");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    void window.platform.getAIProfiles().then(result => {
      const profile = unwrap(result).find(p => p.id === project.aiProfileId);
      if (alive) setReason(!profile ? "当前项目未配置有效 AI 连接，不能使用 AI 解决冲突。" : !profile.outboundEnabled ? "AI 连接尚未允许发送项目材料。" : "");
    }).catch(error => { if (alive) { setReason("无法确认 AI 配置"); setError(message(error)); } });
    return () => { alive = false; };
  }, [project.aiProfileId]);
  async function queue(mode: "continue" | "ai") {
    setBusy(true); setError("");
    try { unwrap(await window.platform.updateCode(project.id, mode)); onQueued(); }
    catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  }
  return <div className="modal-backdrop"><section className="editor modal" role="dialog" aria-modal="true" aria-labelledby="code-conflict-title">
    <h2 id="code-conflict-title">选择冲突处理方式</h2>
    <p>{task.error?.message}</p>
    <p className="muted">Rebase 已暂停，本地提交有备份引用。AI 会修改并暂存冲突文本、继续 rebase；不会推送远端，完成后请检查代码并测试。</p>
    <div className="row-actions">
      <button className="secondary" disabled={busy} onClick={() => setManual(true)}>自行解决冲突</button>
      <button className="primary" disabled={busy || Boolean(reason)} title={reason || undefined} onClick={() => void queue("ai")}>AI 解决并继续</button>
    </div>
    {reason && <p className="muted">{reason}</p>}
    {manual && <div className="notice"><p>在报错仓库中运行 git status，编辑冲突文件并执行 git add，再点击继续；也可执行 git rebase --abort 放弃本轮 rebase。</p><button className="secondary" disabled={busy} onClick={() => void queue("continue")}>已自行解决，继续更新</button></div>}
    {error && <div className="error-panel" role="alert">{error}</div>}
    <div className="form-footer"><button className="secondary" disabled={busy} onClick={onClose}>稍后处理</button></div>
  </section></div>;
}
