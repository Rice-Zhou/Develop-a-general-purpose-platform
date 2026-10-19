import { useState, useEffect, type FormEvent } from "react";
import type { PublicAIProfile } from "../../../../../packages/contracts/src/analysis";
import type { PublicIssueConnection } from "../../../../../packages/contracts/src/issues";
import type {
  Project,
  ProjectDraft,
} from "../../../../../packages/contracts/src/models";
import { message, unwrap } from "../api";
import { RepositoryBranchField } from "./RepositoryBranchField";
export function ProjectEditor({
  project,
  onClose,
  onSaved,
}: {
  project: Project | null;
  onClose: () => void;
  onSaved: () => void;
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
      unwrap(await window.platform.saveProject(draft, project?.revision));
      onSaved();
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
                <span>仓库 {String(index + 1).padStart(2, "0")}</span>
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
            <p className="muted small">
              本地 Word、PDF 将捕获为固定快照；飞书通过设置中的 CLI
              只读获取。必需资料失败时任务会停止。
            </p>
            {draft.documents.map((doc, index) => (
              <div className="binding-form" key={doc.id}>
                <div className="form-row">
                  <label>
                    文档类型
                    <select
                      value={doc.kind}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          documents: draft.documents.map((item, i) =>
                            i === index
                              ? {
                                  ...item,
                                  kind: e.target.value as typeof doc.kind,
                                }
                              : item,
                          ),
                        })
                      }
                    >
                      <option value="docx">Word .docx</option>
                      <option value="pdf">PDF</option>
                      <option value="feishu">飞书文档</option>
                    </select>
                  </label>
                  <label className="grow">
                    文档路径或链接
                    <input
                      required
                      value={doc.locator}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          documents: draft.documents.map((item, i) =>
                            i === index
                              ? { ...item, locator: e.target.value }
                              : item,
                          ),
                        })
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        documents: draft.documents.filter(
                          (_, i) => i !== index,
                        ),
                      })
                    }
                  >
                    移除
                  </button>
                </div>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={doc.required}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        documents: draft.documents.map((item) =>
                          item.id === doc.id
                            ? { ...item, required: event.target.checked }
                            : item,
                        ),
                      })
                    }
                  />
                  必需文档（读取失败时停止分析）
                </label>
              </div>
            ))}
            <button
              type="button"
              className="text-button"
              onClick={() =>
                setDraft({
                  ...draft,
                  documents: [
                    ...draft.documents,
                    {
                      id: crypto.randomUUID(),
                      kind: "docx",
                      locator: "",
                      required: true,
                    },
                  ],
                })
              }
            >
              ＋ 关联文档
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() =>
                void (async () => {
                  try {
                    const paths = unwrap(
                      await window.platform.chooseDocumentFiles(),
                    );
                    setDraft((current) => ({
                      ...current,
                      documents: [
                        ...current.documents,
                        ...paths.map((locator) => ({
                          id: crypto.randomUUID(),
                          kind: locator.toLowerCase().endsWith(".pdf")
                            ? ("pdf" as const)
                            : ("docx" as const),
                          locator,
                          required: true,
                        })),
                      ],
                    }));
                  } catch (error) {
                    setError(message(error));
                  }
                })()
              }
            >
              从本机选择 Word / PDF
            </button>
          </details>
          <details className="config-details">
            <summary>
              BUG 项目范围 <span>{draft.issueBindings.length} 条</span>
            </summary>
            <p className="muted small">
              按来源连接、远端项目、稳定负责人标识和 BUG 类型共同限制。Jira
              Cloud 使用 accountId，Server/DC 使用登录名；Trinity 使用
              assigneeId，类型填写 BUG。
            </p>
            {draft.issueBindings.map((binding, index) => (
              <div className="binding-form" key={binding.id}>
                <label>
                  BUG 来源连接
                  <select
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
                                issueTypeIds:
                                  issueConnections.find(
                                    (c) => c.id === e.target.value,
                                  )?.kind === "trinity"
                                    ? ["BUG"]
                                    : undefined,
                              }
                            : item,
                        ),
                      })
                    }
                  >
                    <option value="">请选择已保存连接</option>
                    {issueConnections.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} · {c.platform}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="muted small">
                  {binding.platform} ·{" "}
                  {binding.instanceUrl || "选择连接后确定实例"}
                </p>
                <label>
                  BUG 类型 ID（逗号分隔）
                  <input
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
                        projectKey: "远端项目标识",
                        owner: "负责人标识",
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
              onClick={() =>
                setDraft({
                  ...draft,
                  issueBindings: [
                    ...draft.issueBindings,
                    {
                      id: crypto.randomUUID(),
                      platform: "jira-dc",
                      instanceUrl: "",
                      projectKey: "",
                      owner: "",
                    },
                  ],
                })
              }
            >
              ＋ 添加 BUG 项目范围
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
