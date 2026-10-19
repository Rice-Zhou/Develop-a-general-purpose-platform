import { useEffect, useState, type FormEvent } from "react";
import type {
  AIProfileDraft,
  PublicAIProfile,
} from "../../../../../packages/contracts/src/analysis";
import { unwrap, message } from "../api";
export function ConnectionsPage({ onChanged }: { onChanged: () => void }) {
  const [profiles, setProfiles] = useState<PublicAIProfile[]>([]);
  const [kind, setKind] = useState<AIProfileDraft["kind"]>("api");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [model, setModel] = useState("");
  const [executable, setExecutable] = useState("");
  const [key, setKey] = useState("");
  const [proxyUrl, setProxyUrl] = useState("");
  const [outbound, setOutbound] = useState(false);
  const [lark, setLark] = useState("");
  const [identity, setIdentity] = useState<"user" | "bot">("user");
  const [detected, setDetected] = useState({ codex: "", claude: "" });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    const [p, c] = await Promise.all([
      window.platform.getAIProfiles(),
      window.platform.getCliConfiguration(),
    ]);
    setProfiles(unwrap(p));
    const config = unwrap(c);
    setLark(config.larkExecutable);
    setIdentity(config.identity);
    setDetected({
      codex: config.codexExecutable,
      claude: config.claudeExecutable,
    });
  }
  useEffect(() => {
    void load().catch((e) => setError(message(e)));
  }, []);
  async function act(action: () => Promise<void>) {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await action();
      onChanged();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  function save(event: FormEvent) {
    event.preventDefault();
    void act(async () => {
      const base = {
        name,
        model,
        outboundEnabled: outbound,
        ...(proxyUrl.trim() ? { proxyUrl: proxyUrl.trim() } : {}),
      };
      const draft: AIProfileDraft =
        kind === "api"
          ? { ...base, kind, baseUrl: url }
          : { ...base, kind, executable };
      unwrap(await window.platform.saveAIProfile(draft, key || undefined));
      setKey("");
      setName("");
      setProxyUrl("");
      setProfiles(unwrap(await window.platform.getAIProfiles()));
      setNotice("连接已保存，请在项目配置中选择使用。");
    });
  }
  return (
    <div className="workspace-stack">
      {error && (
        <div className="error-panel" role="alert">
          {error}
        </div>
      )}
      {notice && <div className="notice">{notice}</div>}
      <section className="panel work-panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">EXECUTION CONNECTIONS</span>
            <h2>模型 API 与账号订阅工具</h2>
          </div>
          <span className="tag">按项目选择</span>
        </div>
        <p className="muted">
          API 使用配置的服务地址和模型名；ChatGPT / Claude Code
          使用本机工具自己的登录。连接不会自动互相切换。
        </p>
        <form onSubmit={save} className="connection-form">
          <div className="form-row">
            <label className="grow">
              连接名称
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：公司模型 / 我的 ChatGPT"
              />
            </label>
            <label>
              执行方式
              <select
                value={kind}
                onChange={(e) => {
                  const next = e.target.value as AIProfileDraft["kind"];
                  setKind(next);
                  setExecutable(next === "api" ? "" : detected[next]);
                  setKey("");
                }}
              >
                <option value="api">模型 API · Chat Completions</option>
                <option value="codex">ChatGPT 订阅 · Codex CLI</option>
                <option value="claude">CC 订阅 · Claude Code</option>
              </select>
            </label>
          </div>
          {kind === "api" ? (
            <>
              <label>
                模型服务地址
                <input
                  required
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://model.example.com/v1"
                />
              </label>
              <label>
                API 密钥
                <input
                  type="password"
                  autoComplete="new-password"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="加密保存，不会读回；本机模型可留空"
                />
              </label>
            </>
          ) : (
            <>
              <label>
                工具可执行文件
                <input
                  required
                  value={executable}
                  onChange={(e) => setExecutable(e.target.value)}
                  placeholder="选择工具的实际 .exe 路径"
                />
              </label>
              <p className="muted small">
                请先在所选工具完成订阅账号登录。平台通过标准输入传递材料，并禁用工具自身的文件、命令与连接器操作。
              </p>
            </>
          )}
          <label>
            模型名称{kind !== "api" ? "（可留空使用工具默认值）" : ""}
            <input
              required={kind === "api"}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="使用服务或工具提供的准确模型名"
            />
          </label>
          <label>
            此 AI 连接的代理（可选）
            <input
              type="url"
              value={proxyUrl}
              onChange={(e) => setProxyUrl(e.target.value)}
              placeholder="http://127.0.0.1:7890；留空直连"
            />
          </label>
          <p className="muted small">
            默认直连，不继承系统代理。仅支持无账号密码的 HTTP(S) 代理，仅用于此
            AI 连接。
            {kind !== "api" &&
              "订阅 CLI 若通过自身配置覆盖环境代理，以工具实际行为为准；平台不会修改其登录或用户配置。"}
          </p>
          <label className="check-label">
            <input
              type="checkbox"
              checked={outbound}
              onChange={(e) => setOutbound(e.target.checked)}
            />
            允许此连接接收我明确选择的项目材料
          </label>
          <button className="primary" disabled={busy}>
            保存模型连接
          </button>
        </form>
        <div className="connection-list">
          {profiles.length === 0 ? (
            <p className="muted">
              尚未配置模型连接。本地文档和人工需求管理仍可使用。
            </p>
          ) : (
            profiles.map((profile) => (
              <div className="connection-item" key={profile.id}>
                <div>
                  <strong>{profile.name}</strong>
                  <p className="muted small">
                    {profile.kind === "api"
                      ? profile.baseUrl
                      : profile.executable}
                    <br />
                    {profile.model || "工具默认模型"} ·{" "}
                    {profile.proxyUrl ? `代理：${profile.proxyUrl}` : "直连"} ·{" "}
                    {profile.outboundEnabled
                      ? "已允许材料发送"
                      : "尚未允许材料发送"}
                    {profile.kind === "api"
                      ? ` · ${profile.hasCredential ? "已保存密钥" : "未保存密钥"}`
                      : ""}
                  </p>
                </div>
                <div className="row-actions">
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        const result = unwrap(
                          await window.platform.probeExecutor(profile.id),
                        );
                        setNotice(result.detail);
                      })
                    }
                  >
                    测试连接
                  </button>
                  <button
                    className="text-button danger-text"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        unwrap(
                          await window.platform.deleteAIProfile(profile.id),
                        );
                        setProfiles(
                          unwrap(await window.platform.getAIProfiles()),
                        );
                        setNotice("连接已删除，关联项目需要重新选择。");
                      })
                    }
                  >
                    删除
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
      <section className="panel work-panel">
        <span className="eyebrow">FEISHU DOCUMENT SOURCE</span>
        <h2>飞书 CLI</h2>
        <p className="muted">
          优先通过 lark-cli v2 只读导出整篇文档，保留原始块
          ID。登录与文档授权由飞书 CLI 管理。
        </p>
        <label>
          飞书 CLI 可执行文件
          <input
            value={lark}
            onChange={(e) => setLark(e.target.value)}
            placeholder="lark-cli.exe 的实际路径"
          />
        </label>
        <label>
          访问身份
          <select
            value={identity}
            onChange={(e) => setIdentity(e.target.value as typeof identity)}
          >
            <option value="user">当前 CLI 用户</option>
            <option value="bot">CLI 机器人身份</option>
          </select>
        </label>
        <button
          className="primary"
          disabled={busy}
          onClick={() =>
            void act(async () => {
              unwrap(
                await window.platform.saveCliConfiguration({
                  larkExecutable: lark,
                  identity,
                }),
              );
              const result = unwrap(await window.platform.probeFeishu());
              setNotice(result.detail);
            })
          }
        >
          保存并检查飞书 CLI
        </button>
      </section>
    </div>
  );
}
