import { useState, type FormEvent } from "react";
import type { PublicAIProfile } from "../../../../../packages/contracts/src/analysis";
import type { Project } from "../../../../../packages/contracts/src/models";
import { message, unwrap } from "../api";

export function DeleteAIProfileDialog({ profile, profiles, projects, isDefault, onClose, onDeleted }: {
  profile: PublicAIProfile;
  profiles: PublicAIProfile[];
  projects: Project[];
  isDefault: boolean;
  onClose: () => void;
  onDeleted: () => Promise<void>;
}) {
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function confirm(event: FormEvent) {
    event.preventDefault();
    if (!choice || busy) return;
    setBusy(true); setError("");
    try {
      unwrap(await window.platform.deleteAIProfile(profile.id, choice === "unlink" ? null : choice));
      await onDeleted();
      onClose();
    } catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  }
  return <div className="modal-backdrop"><form className="editor modal" role="dialog" aria-modal="true" aria-labelledby="delete-ai-title" onSubmit={event => void confirm(event)}>
    <h2 id="delete-ai-title">删除 AI 连接</h2>
    <p>将删除“{profile.name}”。项目、代码、历史任务和报告会保留。</p>
    {isDefault && <p>此连接是默认 AI；默认连接将同步为您选择的替代连接，或清空为未配置。</p>}
    <p>受影响项目：{projects.length ? "" : "无"}</p>
    {projects.length > 0 && <ul>{projects.map(project => <li key={project.id}>{project.name}（{project.usesDefaultAI ? "继承默认 AI" : "单独覆盖"}）</li>)}</ul>}
    <p className="muted">关联项目如有活动任务，请先取消并等待取消完成，再删除连接。</p>
    <label>删除后的 AI 配置
      <select value={choice} required disabled={busy} onChange={event => setChoice(event.target.value)}>
        <option value="">请选择处理方式</option>
        <option value="unlink">解除关联（未配置）</option>
        {profiles.filter(candidate => candidate.id !== profile.id).map(candidate => <option key={candidate.id} value={candidate.id}>替换为：{candidate.name}</option>)}
      </select>
    </label>
    <p className="muted">解除关联后受影响项目将不使用 AI。选择替代连接后，后续任务会使用所选连接及其计费来源。</p>
    {error && <p role="alert" className="error">{error}</p>}
    <div className="row-actions"><button type="button" className="secondary" disabled={busy} onClick={onClose}>取消</button><button type="submit" disabled={busy || !choice}>确认删除</button></div>
  </form></div>;
}
