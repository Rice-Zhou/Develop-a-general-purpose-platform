import { useEffect, useState, type FormEvent } from "react";
import type {
  IssueConnectionDraft,
  PublicIssueConnection,
} from "../../../../../packages/contracts/src/issues";
import { message, unwrap } from "../api";
export function IssueConnectionsPage() {
  const [connections, setConnections] = useState<PublicIssueConnection[]>([]);
  const [kind, setKind] = useState<"jira-cli" | "trinity">("jira-cli");
  const [platform, setPlatform] = useState<"jira-dc" | "jira-cloud">("jira-dc");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [exe, setExe] = useState("");
  const [config, setConfig] = useState("");
  const [secret, setSecret] = useState("");
  const [direct, setDirect] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function reload() {
    setConnections(unwrap(await window.platform.getIssueConnections()));
  }
  useEffect(() => {
    void Promise.all([
      reload(),
      window.platform.getCliConfiguration().then((r) => {
        const c = unwrap(r);
        setExe(c.jiraExecutable);
        setConfig(c.jiraConfigFile);
      }),
    ]).catch((e) => setError(message(e)));
  }, []);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const draft: IssueConnectionDraft =
        kind === "jira-cli"
          ? {
              kind,
              platform,
              name,
              baseUrl: url,
              executable: exe,
              configFile: config,
              bypassProxy: direct,
            }
          : {
              kind,
              platform: "trinity",
              name,
              baseUrl: url,
              bypassProxy: false,
            };
      unwrap(
        await window.platform.saveIssueConnection(
          draft,
          kind === "trinity" ? secret : undefined,
        ),
      );
      setSecret("");
      await reload();
      setNotice(
        "来源连接已保存，请到项目配置关联远端项目、负责人和 BUG 类型。",
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel work-panel">
      <span className="eyebrow">ISSUE CONNECTIONS</span>
      <h2>Jira CLI 与 Trinity 只读连接</h2>
      <p className="muted">
        Jira 使用本机 CLI 的登录配置。Trinity 当前仅按 BUG
        编号读取；项目列表接口待验证。保存连接不代表已完成真实联调。
      </p>
      {error && (
        <div className="error-panel" role="alert">
          {error}
        </div>
      )}
      {notice && <div className="notice">{notice}</div>}
      <form onSubmit={(e) => void save(e)} className="connection-form">
        <div className="form-row">
          <label className="grow">
            来源连接名称
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            读取方式
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as typeof kind);
                setSecret("");
              }}
            >
              <option value="jira-cli">Jira CLI</option>
              <option value="trinity">Trinity V6.5 detail</option>
            </select>
          </label>
        </div>
        <label>
          来源实例地址
          <input
            required
            type="url"
            placeholder={
              kind === "jira-cli"
                ? "https://yfjira.mychery.com"
                : "https://your-instance/trinity"
            }
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
        {kind === "jira-cli" ? (
          <>
            <label>
              Jira 部署
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value as typeof platform)}
              >
                <option value="jira-dc">Server / Data Center</option>
                <option value="jira-cloud">Cloud</option>
              </select>
            </label>
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
            <label className="check-label">
              <input
                type="checkbox"
                checked={direct}
                onChange={(e) => setDirect(e.target.checked)}
              />
              此 Jira 实例直连，忽略该子进程的代理环境
            </label>
          </>
        ) : (
          <label>
            Trinity token（加密保存，不可读回）
            <input
              required
              type="password"
              autoComplete="off"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
          </label>
        )}
        <button className="primary" disabled={busy}>
          保存 BUG 来源连接
        </button>
      </form>
      {connections.map((c) => (
        <div className="report-list-item" key={c.id}>
          <div>
            <strong>{c.name}</strong>
            <p className="muted small">
              {c.platform} · {c.baseUrl} ·{" "}
              {c.kind === "trinity" ? "按编号读取" : "项目范围列表"}
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
            删除来源连接
          </button>
        </div>
      ))}
    </section>
  );
}
