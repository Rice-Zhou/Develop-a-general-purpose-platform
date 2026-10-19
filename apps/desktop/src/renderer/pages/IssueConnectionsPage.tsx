import { useEffect, useRef, useState, type FormEvent } from "react";
import type {
  IssueConnectionDraft,
  PublicIssueConnection,
  LocalJiraConfiguration,
} from "../../../../../packages/contracts/src/issues";
import { message, unwrap } from "../api";
export function IssueConnectionsPage() {
  const formEdited = useRef(false);
  const [connections, setConnections] = useState<PublicIssueConnection[]>([]);
  const [platform, setPlatform] = useState<"jira" | "trinity">("jira");
  const [jiraMode, setJiraMode] = useState<"cli" | "account">("cli");
  const [local, setLocal] = useState<LocalJiraConfiguration | null>(null);
  const [checking, setChecking] = useState(true);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [exe, setExe] = useState("");
  const [config, setConfig] = useState("");
  const [deployment, setDeployment] = useState<"jira-dc" | "jira-cloud">(
    "jira-dc",
  );
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function reload() {
    setConnections(unwrap(await window.platform.getIssueConnections()));
  }
  useEffect(() => {
    let active = true;
    void reload().catch((e) => setError(message(e)));
    void window.platform
      .inspectLocalJira()
      .then((response) => {
        const result = unwrap(response);
        if (!active) return;
        setLocal(result);
        if (formEdited.current) return;
        setExe(result.executable);
        setConfig(result.configFile);
        if (result.available) {
          setUrl(result.baseUrl);
          setUsername(result.username);
          if (result.platform) setDeployment(result.platform);
        } else setJiraMode("account");
      })
      .catch((e) => {
        if (active) {
          setError(message(e));
          if (!formEdited.current) setJiraMode("account");
        }
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, []);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const draft: IssueConnectionDraft =
        platform === "trinity"
          ? {
              kind: "trinity",
              platform: "trinity",
              name: name || "Trinity",
              baseUrl: url,
              username,
              bypassProxy: true,
            }
          : jiraMode === "cli"
            ? {
                kind: "jira-cli",
                platform: deployment,
                name: name || "Jira",
                baseUrl: url,
                executable: exe,
                configFile: config,
                bypassProxy: true,
              }
            : {
                kind: "jira-http",
                platform: "jira-dc",
                name: name || "Jira",
                baseUrl: url,
                username,
                bypassProxy: true,
              };
      unwrap(
        await window.platform.saveIssueConnection(
          draft,
          draft.kind === "jira-cli" ? undefined : password,
        ),
      );
      setPassword("");
      await reload();
      setNotice(
        "平台连接已保存。请在项目的 BUG 项目范围中选择该连接，并填写项目 Key、负责人和缺陷类型。",
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel work-panel">
      <span className="eyebrow">BUG PLATFORM LOGIN</span>
      <h2>Jira 与 Trinity 登录</h2>
      <p className="muted">
        先登录平台，再到项目配置选择接收哪些 BUG。所有 BUG
        平台连接均使用本地网络直连。
      </p>
      {error && (
        <div className="error-panel" role="alert">
          {error}
        </div>
      )}
      {notice && <div className="notice">{notice}</div>}
      <form
        onSubmit={(e) => void save(e)}
        onChangeCapture={() => {
          formEdited.current = true;
        }}
        className="connection-form"
      >
        <div className="form-row">
          <label>
            BUG 平台
            <select
              value={platform}
              onChange={(e) => {
                const value = e.target.value as typeof platform;
                setPlatform(value);
                setPassword("");
                setUsername(value === "jira" ? (local?.username ?? "") : "");
                setUrl(
                  value === "trinity"
                    ? "https://trinity.desaysv.com/trinity"
                    : (local?.baseUrl ?? ""),
                );
              }}
            >
              <option value="jira">Jira</option>
              <option value="trinity">Trinity</option>
            </select>
          </label>
          <label className="grow">
            连接名称
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="可选，例如：我的 Jira"
            />
          </label>
        </div>
        {platform === "jira" && (
          <>
            <p className="muted small" aria-live="polite">
              {checking ? "正在检查本地 Jira CLI 登录状态…" : local?.detail}
            </p>
            {local?.available && (
              <p className="notice">
                本地已登录：{local.username} · {local.baseUrl}
              </p>
            )}
            <label>
              Jira 登录方式
              <select
                value={jiraMode}
                onChange={(e) => {
                  setJiraMode(e.target.value as typeof jiraMode);
                  setPassword("");
                }}
              >
                <option value="cli">复用本地 Jira CLI（优先）</option>
                <option value="account">
                  账号密码登录（Server / Data Center）
                </option>
              </select>
            </label>
          </>
        )}
        <label>
          平台地址
          <input
            required
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={
              platform === "jira"
                ? "https://your-jira-instance"
                : "https://trinity.desaysv.com/trinity"
            }
          />
        </label>
        {platform === "jira" && jiraMode === "cli" ? (
          <details open={!local?.available}>
            <summary>Jira CLI 配置</summary>
            <label>
              Jira 可执行文件
              <input
                required
                value={exe}
                onChange={(e) => setExe(e.target.value)}
              />
            </label>
            <label>
              Jira CLI 配置文件
              <input
                required
                value={config}
                onChange={(e) => setConfig(e.target.value)}
              />
            </label>
            <label>
              Jira 部署
              <select
                value={deployment}
                onChange={(e) =>
                  setDeployment(e.target.value as typeof deployment)
                }
              >
                <option value="jira-dc">Server / Data Center</option>
                <option value="jira-cloud">Cloud</option>
              </select>
            </label>
          </details>
        ) : (
          <>
            <label>
              登录账号
              <input
                required
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </label>
            <label>
              登录密码
              <input
                required
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <p className="muted small">
              {platform === "trinity"
                ? "登录成功后仅加密保存会话 token，密码不保存。当前按 BUG 编号读取，项目列表接口仍待验证。"
                : "登录成功后在本机加密保存密码，不可读回；此方式用于支持账号密码认证的 Server / Data Center。Cloud 请使用本地 CLI 登录。"}
            </p>
          </>
        )}
        <button className="primary" disabled={busy || checking}>
          {busy
            ? "正在登录并保存…"
            : platform === "jira" && jiraMode === "cli"
              ? "保存本地 Jira 连接"
              : "登录并保存平台连接"}
        </button>
      </form>
      {connections.map((c) => (
        <div className="report-list-item" key={c.id}>
          <div>
            <strong>{c.name}</strong>
            <p className="muted small">
              {c.kind === "trinity" ? "Trinity" : "Jira"} · {c.baseUrl} ·{" "}
              {c.kind === "jira-cli"
                ? "本地 CLI"
                : "username" in c && c.username
                  ? `账号 ${c.username}`
                  : "已有会话"}
            </p>
          </div>
          <button
            disabled={busy}
            className="text-button danger-text"
            onClick={() => {
              setBusy(true);
              setError("");
              void window.platform
                .deleteIssueConnection(c.id)
                .then((r) => {
                  unwrap(r);
                  return reload();
                })
                .catch((e) => setError(message(e)))
                .finally(() => setBusy(false));
            }}
          >
            删除平台连接
          </button>
        </div>
      ))}
    </section>
  );
}
