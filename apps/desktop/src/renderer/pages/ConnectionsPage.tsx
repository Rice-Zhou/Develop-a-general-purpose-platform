import { parseAIAddress } from "../../../../../packages/contracts/src/ai-address";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type {CodexDiscovery} from "../../../../../packages/contracts/src/codex";
import type {
  AIProfileDraft,
  PublicAIProfile,
} from "../../../../../packages/contracts/src/analysis";
import { unwrap, message } from "../api";
import type { Project } from "../../../../../packages/contracts/src/models";
import { DeleteAIProfileDialog } from "../components/DeleteAIProfileDialog";
export function ConnectionsPage({ onChanged }: { onChanged: () => void }) {
  const [editingId, setEditingId] = useState<string>();
  const [profiles, setProfiles] = useState<PublicAIProfile[]>([]);
  const [deleting, setDeleting] = useState<{ profile: PublicAIProfile; projects: Project[] } | null>(null);
  const [defaultId, setDefaultId] = useState<string | null>(null);
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
  const [detected, setDetected] = useState({ claude: "" });
  const [codex, setCodex] = useState<CodexDiscovery|null>(null);
  const [detecting, setDetecting] = useState(false);
  const [codexError, setCodexError] = useState("");
  const discoveryRequest=useRef(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    const [p, c] = await Promise.all([
      window.platform.getAIProfiles(),
      window.platform.getCliConfiguration(),
    ]);
    setProfiles(unwrap(p));
    setDefaultId(unwrap(await window.platform.getDefaultAIProfile()));
    const config = unwrap(c);
    setLark(config.larkExecutable);
    setIdentity(config.identity);
    setDetected({
      claude: config.claudeExecutable,
    });
  }
  useEffect(() => {
    void load().catch((e) => setError(message(e)));
    return ()=>{discoveryRequest.current++;};
  }, []);
  async function detectCodex(currentModel=model,proxy=proxyUrl) {
    const request=++discoveryRequest.current;setCodex(null);setExecutable("");setCodexError("");setDetecting(true);
    try {
      const result=unwrap(await window.platform.discoverCodex(proxy.trim()||undefined));
      if(request!==discoveryRequest.current)return;
      setCodex(result);setExecutable(result.selected.executable);
      if(currentModel && !result.models.some(m=>m.id===currentModel)){setModel("");setCodexError("原模型不在最新 CLI 的账号列表中，请重新选择模型。");}
      else setModel(currentModel||result.models.find(m=>m.isDefault)?.id||result.models[0].id);
    }catch(error){if(request===discoveryRequest.current)setCodexError(message(error));}
    finally{if(request===discoveryRequest.current)setDetecting(false);}
  }
  function edit(profile:PublicAIProfile) {
    discoveryRequest.current++;setDetecting(false);setCodex(null);setCodexError("");
    setEditingId(profile.id);setName(profile.name);setKind(profile.kind);setModel(profile.model);setOutbound(profile.outboundEnabled);setProxyUrl(profile.proxyUrl??"");setUrl(profile.kind==="api"?profile.baseUrl:"");setExecutable(profile.kind==="api"?"":profile.executable);setKey("");
    if(profile.kind==="codex")void detectCodex(profile.model,profile.proxyUrl??"");
  }
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
      unwrap(await window.platform.saveAIProfile(draft, key || undefined, editingId));
      discoveryRequest.current++;setCodex(null);setCodexError("");setDetecting(false);setKind("api");setModel("");setExecutable("");
      setEditingId(undefined);
      setKey("");
      setName("");
      setProxyUrl("");
      setProfiles(unwrap(await window.platform.getAIProfiles()));
      setDefaultId(unwrap(await window.platform.getDefaultAIProfile()));
      setNotice("连接已保存。首个连接自动作为默认 AI，未单独覆盖的项目自动使用默认连接。");
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
          <span className="tag">默认继承 · 项目可覆盖</span>
        </div>
        <p className="muted">
          API 使用配置的服务地址和模型名；ChatGPT / Claude Code
          使用本机工具自己的登录。项目默认继承默认 AI，也可单独指定连接；执行失败时不会切换到其他连接。
        </p>
        {editingId && <p role="status">正在编辑现有连接；留空密钥会保留原密钥。<button className="text-button" onClick={()=>{discoveryRequest.current++;setCodex(null);setDetecting(false);setCodexError("");setKind("api");setEditingId(undefined);setName("");setKey("");setUrl("");setProxyUrl("");}}>取消编辑</button></p>}
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
                aria-label="执行方式"
                value={kind}
                onChange={(e) => {
                  const next = e.target.value as AIProfileDraft["kind"];
                  discoveryRequest.current++;setCodex(null);setCodexError("");setDetecting(false);
                  setKind(next);
                  setExecutable(next === "claude" ? detected.claude : "");
                  if(next === "codex"){setModel("");void detectCodex("",proxyUrl);}
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
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="model.example.com/v1"
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
          ) : kind === "codex" ? (
            <>
              <label>已自动选择的 Codex CLI<input readOnly value={executable} placeholder="正在检测本地 Codex CLI" /></label>
              {codex&&<p className="muted small">版本：{codex.selected.version} · 当前 ChatGPT 登录{codex.planType?` · ${codex.planType}`:""}</p>}
              {codex&&<details><summary>检测到的 CLI（按版本选择最新）</summary>{codex.candidates.map(candidate=><p className="small" key={candidate.executable}>{candidate.executable} · {candidate.version??candidate.error}</p>)}</details>}
              <button className="secondary" type="button" disabled={busy||detecting} onClick={()=>void detectCodex()}>重新检测 Codex CLI 与模型</button>
              {detecting&&<p role="status">正在检测版本并读取当前账号的模型列表…</p>}
              {codexError&&<p className="error-panel" role="alert">{codexError}</p>}
              <p className="muted small">自动检查 PATH、npm 和桌面端安装目录。仅使用最新 CLI 返回的账号模型；此过程不调用模型、不发送项目材料。请先在 Codex 完成登录。</p>
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
          {kind === "codex" ? <label>Codex 模型<select aria-label="Codex 模型" required disabled={!codex||detecting} value={model} onChange={event=>{setModel(event.target.value);setCodexError("");}}>
            {!model&&<option value="">请选择当前账号可用模型</option>}
            {codex?.models.map(item=><option key={item.id} value={item.id}>{item.name}（{item.id}）{item.isDefault?" · 默认":""}</option>)}
          </select></label> : <label>
            模型名称{kind !== "api" ? "（可留空使用工具默认值）" : ""}
            <input
              required={kind === "api"}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="使用服务或工具提供的准确模型名"
            />
          </label>}
          <label>
            此 AI 连接的代理（可选）
            <input
              type="text"
              value={proxyUrl}
              onChange={(e) => {setProxyUrl(e.target.value);if(kind==="codex"){discoveryRequest.current++;setCodex(null);setExecutable("");setDetecting(false);setCodexError("代理配置已变化，请重新检测 CLI 与账号模型。");}}}
              placeholder="127.0.0.1:7890；留空直连"
            />
          </label>
          <p className="muted small">
            默认直连，不继承系统代理。仅支持无账号密码的 HTTP(S) 代理，仅用于此
            AI 连接。
            {kind !== "api" &&
              "订阅 CLI 若通过自身配置覆盖环境代理，以工具实际行为为准；平台不会修改其登录或用户配置。"}
          </p>
          <AddressCandidates value={kind === "api" ? url : ""} kind="api" />
          <AddressCandidates value={proxyUrl} kind="proxy" />
          <label className="check-label">
            <input
              type="checkbox"
              checked={outbound}
              onChange={(e) => setOutbound(e.target.checked)}
            />
            允许此连接接收我明确选择的项目材料
          </label>
          <button className="primary" disabled={busy || (kind === "codex" && (detecting || !codex || !model))}>
            {editingId ? "保存连接修改" : "保存模型连接"}
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
                  <strong>{profile.name}{profile.id === defaultId ? " · 默认 AI" : ""}</strong>
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
                  <button className="secondary" disabled={busy} onClick={()=>edit(profile)}>编辑连接</button>
                  {profile.protocolDiagnostic && <p className="muted small">{profile.protocolDiagnostic}</p>}
                  {profile.id !== defaultId && <button className="secondary" disabled={busy} onClick={() => void act(async () => { unwrap(await window.platform.setDefaultAIProfile(profile.id)); setDefaultId(profile.id); setNotice("默认 AI 已更新，继承默认的项目已同步，单独覆盖的项目保持不变。"); })}>设为默认 AI</button>}
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
                        const projects = unwrap(await window.platform.listProjects());
                        setDeleting({ profile, projects: projects.filter(project => project.aiProfileId === profile.id) });
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
      {deleting && <DeleteAIProfileDialog profile={deleting.profile} profiles={profiles} projects={deleting.projects} isDefault={deleting.profile.id === defaultId} onClose={() => setDeleting(null)} onDeleted={async () => {
        setProfiles(unwrap(await window.platform.getAIProfiles()));
        setDefaultId(unwrap(await window.platform.getDefaultAIProfile()));
        setNotice("连接已删除，受影响项目和默认 AI 已按所选方式更新。");
        onChanged();
      }} />}
    </div>
  );
}

function AddressCandidates({value,kind}:{value:string;kind:"api"|"proxy"}) {
  if (!value.trim()) return null;
  try { const result=parseAIAddress(value,kind); return <p className="muted small">{kind === "api" ? "API" : "代理"}候选：{result.httpsUrl} → {result.httpUrl}（HTTP 未加密，仅 HTTPS 连接失败时尝试）</p>; }
  catch { return <p className="error-panel">地址格式无效，请检查主机、端口和路径。</p>; }
}
