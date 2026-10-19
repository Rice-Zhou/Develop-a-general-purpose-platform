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
import { DocumentBindingsEditor } from "./DocumentBindingsEditor";
export function ProjectEditor({
  project,
  onClose,
  onSaved,
}: {
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
          issueBindings: project.issueBindings,
          aiProfileId: project.aiProfileId,
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
  const [jiraEnabled, setJiraEnabled] = useState(Boolean(project?.issueBindings.some((b) => b.platform !== "trinity")));
  const [jiraReady, setJiraReady] = useState(false);
  const jiraBindings = draft.issueBindings.filter((b) => b.platform !== "trinity");
  const [profiles, setProfiles] = useState<PublicAIProfile[]>([]);
  const [issueConnections, setIssueConnections] = useState<
    PublicIssueConnection[]
  >([]);
  useEffect(() => {
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
      if (jiraEnabled && (!jiraReady || !draft.issueBindings.some((b) => b.platform !== "trinity"))) throw new Error("请先读取 Jira 项目列表并选择一个项目及缺陷类型");
      const saved = unwrap(
        await window.platform.saveProject(draft, project?.revision),
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
  function addTrinityBinding() {
    setDraft((current) => ({
      ...current,
      issueBindings: [
        ...current.issueBindings,
        {
          id: crypto.randomUUID(),
          platform: "trinity",
          instanceUrl: "",
          projectKey: "",
          owner: "",
          issueTypeIds: ["BUG"],
        },
      ],
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
            <h2 id="editor-title">{project ? "编辑项目" : "添加项目"}</h2>
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
          <label>
            AI 执行连接
            <select
              value={draft.aiProfileId ?? ""}
              onChange={(e) =>
                setDraft({ ...draft, aiProfileId: e.target.value || null })
              }
            >
              <option value="">不关联（可使用本地文档和人工需求）</option>
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
            <DocumentBindingsEditor documents={draft.documents} onError={setError} disabled={busy} onChange={update => setDraft(current => ({ ...current, documents: typeof update === "function" ? update(current.documents) : update }))} />
          </details>
          <details className="config-details" open>
            <summary>
              BUG 项目范围 <span>{draft.issueBindings.length} 条</span>
            </summary>
            <p className="muted small">
              Jira 可直接选择 CLI 或账号登录，读取项目列表后单选一个项目；负责人取自登录信息。Trinity 使用已保存连接及范围。
            </p>
            {jiraBindings.length > 1 && <p className="coverage-warning">旧配置包含多个 Jira 范围，请从列表重新选择一个 Jira 项目后保存。</p>}
            {jiraEnabled && <>
              <JiraProjectField
                binding={jiraBindings.length === 1 ? jiraBindings[0] : undefined}
                connections={issueConnections}
                onReadinessChange={setJiraReady}
                onConnectionSaved={(connection) => setIssueConnections((previous) => [...previous.filter((c) => c.id !== connection.id), connection])}
                onChange={(binding) => setDraft((previous) => ({ ...previous, issueBindings: [...previous.issueBindings.filter((b) => b.platform === "trinity"), ...(binding ? [binding] : [])] }))}
              />
              <button type="button" className="text-button" onClick={() => { setJiraEnabled(false); setJiraReady(false); setDraft((previous) => ({ ...previous, issueBindings: previous.issueBindings.filter((b) => b.platform === "trinity") })); }}>移除 Jira 关联</button>
            </>}
            {draft.issueBindings.map((binding, index) => binding.platform === "trinity" && (
              <div className="binding-form" key={binding.id}>
                <label>
                  Trinity 平台连接
                  <select
                    required
                    value={binding.connectionId ?? ""}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        issueBindings: draft.issueBindings.map((item, i) =>
                          i === index
                            ? {
                                ...item,
                                connectionId: e.target.value || undefined,
                                platform:
                                  issueConnections.find(
                                    (c) => c.id === e.target.value,
                                  )?.platform ?? item.platform,
                                instanceUrl:
                                  issueConnections.find(
                                    (c) => c.id === e.target.value,
                                  )?.baseUrl ?? item.instanceUrl,
                                issueTypeIds: ["BUG"],
                              }
                            : item,
                        ),
                      })
                    }
                  >
                    <option value="">请选择已保存连接</option>
                    {issueConnections
                      .filter((c) => c.platform === "trinity")
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} · Trinity
                        </option>
                      ))}
                  </select>
                </label>
                <p className="muted small">
                  Trinity ·{" "}
                  {binding.instanceUrl || "选择连接后确定实例"}
                </p>
                <label>
                  缺陷类型（逗号分隔）
                  <input
                    required
                    value={binding.issueTypeIds?.join(",") ?? ""}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        issueBindings: draft.issueBindings.map((b, i) =>
                          i === index
                            ? {
                                ...b,
                                issueTypeIds: e.target.value
                                  ? e.target.value
                                      .split(",")
                                      .map((s) => s.trim())
                                      .filter(Boolean)
                                  : undefined,
                              }
                            : b,
                        ),
                      })
                    }
                  />
                </label>
                {(["projectKey", "owner"] as const).map((key) => (
                  <label key={key}>
                    {
                      {
                        instanceUrl: "实例地址",
                        projectKey: "项目 Key",
                        owner: "负责人",
                      }[key]
                    }
                    <input
                      required
                      value={binding[key]}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          issueBindings: draft.issueBindings.map((item, i) =>
                            i === index
                              ? { ...item, [key]: e.target.value }
                              : item,
                          ),
                        })
                      }
                    />
                  </label>
                ))}
                <p className="muted small">
                  负责人填写 Trinity 的 assigneeId；缺陷类型填写 BUG。
                </p>
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      issueBindings: draft.issueBindings.filter(
                        (_, i) => i !== index,
                      ),
                    })
                  }
                >
                  移除范围
                </button>
              </div>
            ))}
            <button
              type="button"
              className="text-button"
              disabled={jiraEnabled}
              onClick={() => setJiraEnabled(true)}
            >
              ＋ 添加 Jira 范围
            </button>
            <button
              type="button"
              className="text-button"
              onClick={addTrinityBinding}
            >
              ＋ 添加 Trinity 范围
            </button>
          </details>
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
              {busy ? "正在保存…" : "保存项目"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
