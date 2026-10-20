import { useState, useEffect, type FormEvent } from "react";
import type { PublicAIProfile } from "../../../../../packages/contracts/src/analysis";
import type { PublicIssueConnection } from "../../../../../packages/contracts/src/issues";
import type {
  Project,
  ProjectDraft,
} from "../../../../../packages/contracts/src/models";
import { message, unwrap } from "../api";
import { RepositoryBranchField } from "./RepositoryBranchField";
import { JiraProjectField } from "./JiraProjectField";
import { DocumentResourcePicker } from "./DocumentResourcePicker";
export function ProjectEditor({
  project,
  onClose,
  onSaved,
  linksOnly = false,
  initialIssueConnection,
}: {
  initialIssueConnection?: PublicIssueConnection;
  linksOnly?: boolean;
  project: Project | null;
  onClose: () => void;
  onSaved: (saved: Project) => void;
}) {
  const [draft, setDraft] = useState<ProjectDraft>(
    project
      ? {
          id: project.id,
          name: project.name,
          enabled: project.enabled,
          repositories: project.repositories.map((repo) => ({
            path: repo.canonicalPath,
            branch: repo.branch,
            remoteName: repo.remoteName,
            role: repo.role,
          })),
          documents: project.documents,
          issueBindings: project.issueBindings.filter(b=>b.platform!=="trinity"),
          trinityProjects: project.trinityProjects ?? [],
          aiProfileId: project.usesDefaultAI ? null : project.aiProfileId,
        }
      : {
          name: "",
          enabled: true,
          repositories: [
            { path: "", remoteName: "origin", branch: "", role: "主仓库" },
          ],
          documents: [],
          issueBindings: [],
          aiProfileId: null,
        },
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [jiraEnabled, setJiraEnabled] = useState(Boolean((initialIssueConnection && initialIssueConnection.platform !== "trinity") || project?.issueBindings.some((b) => b.platform !== "trinity")));

  const jiraBindings = draft.issueBindings.filter((b) => b.platform !== "trinity");
  const [profiles, setProfiles] = useState<PublicAIProfile[]>([]);
  const [defaultAIId, setDefaultAIId] = useState<string | null>(null);
  const [issueConnections, setIssueConnections] = useState<
    PublicIssueConnection[]
  >([]);
  useEffect(() => {
    void window.platform.getDefaultAIProfile().then(r => setDefaultAIId(unwrap(r))).catch(e => setError(message(e)));
    void window.platform
      .getIssueConnections()
      .then((r) => setIssueConnections(unwrap(r)))
      .catch((e) => setError(message(e)));
  }, []);
  useEffect(() => {
    void window.platform
      .getAIProfiles()
      .then((result) => setProfiles(unwrap(result)))
      .catch((error) => setError(message(error)));
  }, []);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if(jiraEnabled&&!draft.issueBindings.some(b=>b.platform!=="trinity"))throw new Error("请选择已配置项目的 Jira 连接");
      const saved = unwrap(
        linksOnly && project ? await window.platform.saveProjectLinks({ projectId: project.id, expectedRevision: project.revision, documents: draft.documents, issueBindings: draft.issueBindings, trinityProjects: draft.trinityProjects, aiProfileId: draft.aiProfileId }) : await window.platform.saveProject(draft, project?.revision),
      );
      onSaved(saved);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  async function browse(index: number) {
    try {
      const path = unwrap(await window.platform.chooseRepositoryDirectory());
      if (path) updateRepository(index, { path });
    } catch (err) {
      setError(message(err));
    }
  }
  function updateRepository(
    index: number,
    patch: Partial<ProjectDraft["repositories"][number]>,
  ) {
    setDraft((old) => ({
      ...old,
      repositories: old.repositories.map((repo, i) =>
        i === index ? { ...repo, ...patch } : repo,
      ),
    }));
  }
  return (
    <div className="modal-backdrop">
      <section
        className="editor modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="editor-title"
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">PROJECT CONFIGURATION</span>
            <h2 id="editor-title">{linksOnly ? "管理项目关联" : project ? "编辑项目" : "添加项目"}</h2>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="关闭项目编辑"
          >
            ×
          </button>
        </div>
        <form onSubmit={(event) => void save(event)}>
          {linksOnly && <p>代码项目：{project?.name}。需求、BUG 来源可稍后关联；BUG 预分析直接使用本项目的 AI 连接。</p>}
          {!linksOnly && <>
          <div className="form-row">
            <label className="grow">
              项目名称
              <input
                autoFocus
                required
                maxLength={100}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="例如：座舱 A 项目"
              />
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) =>
                  setDraft({ ...draft, enabled: e.target.checked })
                }
              />
              启用项目
            </label>
          </div>
          <div className="section-heading">
            <h3>独立代码分析目录</h3>
            <button
              type="button"
              className="text-button"
              onClick={() =>
                setDraft({
                  ...draft,
                  repositories: [
                    ...draft.repositories,
                    {
                      path: "",
                      branch: "",
                      remoteName: "origin",
                      role: "关联仓库",
                    },
                  ],
                })
              }
            >
              ＋ 添加仓库
            </button>
          </div>
          <p className="muted small">
            选择目录后读取当前分支，请确认采用或手动填写分析分支。保存不会切换分支；平台只做快进更新，不覆盖本地修改。
          </p>
          {draft.repositories.map((repo, index) => (
            <div className="binding-form" key={index}>
              <div className="binding-label">
                <span>{index === 0 ? "主仓库" : `关联仓库 ${index}`}</span>
                {draft.repositories.length > 1 && (
                  <button
                    type="button"
                    className="text-button danger-text"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        repositories: draft.repositories.filter(
                          (_, i) => i !== index,
                        ),
                      })
                    }
                  >
                    移除
                  </button>
                )}
              </div>
              <label htmlFor={`repo-path-${index}`}>分析目录</label>
              <div className="input-action">
                <input
                  id={`repo-path-${index}`}
                  required
                  value={repo.path}
                  onChange={(e) =>
                    updateRepository(index, { path: e.target.value })
                  }
                  placeholder="选择独立 Git 工作树的根目录"
                />
                <button
                  type="button"
                  className="secondary"
                  onClick={() => void browse(index)}
                >
                  浏览
                </button>
              </div>
              <div className="form-row">
                <RepositoryBranchField
                  id={`repo-branch-${index}`}
                  path={repo.path}
                  branch={repo.branch}
                  onChange={(branch) => updateRepository(index, { branch })}
                />
                <label>
                  远端名称
                  <input
                    required
                    value={repo.remoteName}
                    onChange={(e) =>
                      updateRepository(index, { remoteName: e.target.value })
                    }
                  />
                </label>
                <label>
                  仓库用途
                  <input
                    value={repo.role}
                    onChange={(e) =>
                      updateRepository(index, { role: e.target.value })
                    }
                  />
                </label>
              </div>
            </div>
          ))}
          </>}
          <label>
            AI 执行连接
            <select
              value={draft.aiProfileId ?? ""}
              onChange={(e) =>
                setDraft({ ...draft, aiProfileId: e.target.value || null })
              }
            >
              <option value="">使用默认 AI：{profiles.find(p => p.id === defaultAIId)?.name ?? "未配置"}（无单独覆盖）</option>
              {profiles.map((profile) => (
                <option value={profile.id} key={profile.id}>
                  {profile.name} ·{" "}
                  {profile.kind === "api"
                    ? "模型 API"
                    : profile.kind === "codex"
                      ? "ChatGPT / Codex"
                      : "Claude Code"}
                </option>
              ))}
            </select>
          </label>
          <details className="config-details">
            <summary>
              关联需求文档 <span>{draft.documents.length} 份</span>
            </summary>
            <DocumentResourcePicker documents={draft.documents} onError={setError} disabled={busy} onChange={update => setDraft(current => ({ ...current, documents: typeof update === "function" ? update(current.documents) : update }))} />
          </details>
          <details className="config-details" open>
            <summary>
              BUG 项目范围 <span>{draft.issueBindings.length} 条</span>
            </summary>
            <p className="muted small">
              Jira 选择已配置项目的连接即可；Trinity 当前账号自动关联所有代码项目，无需添加范围。
            </p>
            {jiraBindings.length > 1 && <p className="coverage-warning">旧配置包含多个 Jira 范围，请从列表重新选择一个 Jira 项目后保存。</p>}
            {jiraEnabled && <>
              <JiraProjectField
                initialConnectionId={initialIssueConnection?.platform !== "trinity" ? initialIssueConnection?.id : undefined}
                binding={jiraBindings.length === 1 ? jiraBindings[0] : undefined}
                connections={issueConnections}
                onConnectionSaved={(connection) => setIssueConnections((previous) => [...previous.filter((c) => c.id !== connection.id), connection])}
                onChange={(binding) => setDraft((previous) => ({ ...previous, issueBindings: [...previous.issueBindings.filter((b) => b.platform === "trinity"), ...(binding ? [binding] : [])] }))}
              />
              <button type="button" className="text-button" onClick={() => { setJiraEnabled(false); setDraft((previous) => ({ ...previous, issueBindings: previous.issueBindings.filter((b) => b.platform === "trinity") })); }}>移除 Jira 关联</button>
            </>}
            <button
              type="button"
              className="text-button"
              disabled={jiraEnabled}
              onClick={() => setJiraEnabled(true)}
            >
              ＋ 添加 Jira 范围
            </button>
          </details>
          {issueConnections.filter(c=>c.kind==="trinity").map(c=><div className="binding-form" key={c.id}><h3>Trinity 账号 · 自动关联</h3><p>{c.name} · {"username" in c?c.username:""}。此账号自动应用于所有代码项目。</p>
            <label>Trinity 项目 ID（逗号分隔）<input value={(draft.trinityProjects??[]).filter(m=>m.instanceUrl===c.baseUrl).map(m=>m.projectId).join(",")} onChange={e=>setDraft({...draft,trinityProjects:[...(draft.trinityProjects??[]).filter(m=>m.instanceUrl!==c.baseUrl),...e.target.value.split(",").map(id=>id.trim()).filter(Boolean).map(projectId=>({instanceUrl:c.baseUrl,projectId}))]})}/></label>
            <p className="muted small">填写与本代码项目对应的 Trinity 项目 ID，只在准确匹配时预分析；未匹配的问题仍展示。不填写时不进行本项目的 Trinity BUG 预分析。</p>
          </div>)}
          {error && (
            <div className="error-panel" role="alert">
              {error}
            </div>
          )}
          <div className="form-footer">
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={onClose}
            >
              取消
            </button>
            <button className="primary" disabled={busy}>
              {busy ? "正在保存…" : linksOnly ? "保存关联" : "保存项目"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
