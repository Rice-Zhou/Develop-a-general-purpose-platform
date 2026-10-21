import { useEffect, useRef, useState, type FormEvent } from "react";
import type {
  IssueConnectionDraft,
  PublicIssueConnection,
  LocalJiraConfiguration,
  JiraCatalogue,
} from "../../../../../packages/contracts/src/issues";
import { JiraProjectPicker } from "../components/JiraProjectPicker";
import { message, unwrap } from "../api";
export function IssueConnectionsPage({ embedded = false, onSaved, onLink }: { embedded?: boolean; onSaved?: (connection: PublicIssueConnection) => void; onLink?: (connection: PublicIssueConnection) => void } = {}) {
  const formEdited = useRef(false);
  const [connections, setConnections] = useState<PublicIssueConnection[]>([]);
  const [editingId, setEditingId] = useState<string>();
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
  const [autoLogin, setAutoLogin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [catalogue,setCatalogue]=useState<JiraCatalogue|null>(null);
  const [projectKey,setProjectKey]=useState(""); const [issueTypeIds,setIssueTypeIds]=useState<string[]>([]);
  const authStamp=JSON.stringify([platform,jiraMode,url,exe,config,deployment,username,password]);
  const currentAuth=useRef(authStamp); currentAuth.current=authStamp;
  useEffect(()=>{setCatalogue(null);setProjectKey("");setIssueTypeIds([]);},[authStamp]);
  async function reload() {
    setConnections(unwrap(await window.platform.getIssueConnections()));
  }
  function edit(connection: PublicIssueConnection) {
    formEdited.current = true;
    setEditingId(connection.id);
    setName(connection.name);
    setPlatform(connection.platform === "trinity" ? "trinity" : "jira");
    setJiraMode(connection.kind === "jira-cli" ? "cli" : "account");
    setUrl(connection.baseUrl);
    setUsername("username" in connection ? connection.username ?? "" : "");
    if (connection.platform !== "trinity") setDeployment(connection.platform);
    if (connection.kind === "jira-cli") {
      setExe(connection.executable);
      setConfig(connection.configFile);
    }
    setPassword("");
    setAutoLogin(connection.kind === "trinity" && !!connection.autoLogin);
    setError("");
    setNotice("");
  }
  function addNew() {
    setEditingId(undefined);
    setAutoLogin(false);
    setName(""); setPassword(""); setNotice(""); setError("");
    setPlatform("jira"); setJiraMode(local?.available ? "cli" : "account");
    setUrl(local?.baseUrl ?? ""); setUsername(local?.username ?? "");
    setExe(local?.executable ?? ""); setConfig(local?.configFile ?? "");
    setDeployment(local?.platform ?? "jira-dc");
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
  const Container = embedded ? "div" : "form";
  function buildDraft(): IssueConnectionDraft {
    return platform === "trinity"
          ? {
              kind: "trinity",
              platform: "trinity",
              name: name || "Trinity",
              baseUrl: url,
              username,
              autoLogin,
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

  }
  async function discover() {
    const stamp=authStamp;setBusy(true);setError("");setCatalogue(null);
    try {
      const draft=buildDraft();if(draft.kind==="jira-http"&&!password)throw new Error("请输入登录密码");
      const data=unwrap(await window.platform.discoverJiraConnection(draft,draft.kind==="jira-cli"?undefined:password));
      if(currentAuth.current!==stamp)throw new Error("登录配置已变化，请重新读取 Jira 项目");
      setCatalogue(data);
      const previous=connections.find(c=>c.id===editingId);
      const selected=previous&&previous.kind!=="trinity"?previous.jiraProject:undefined;
      setProjectKey(selected&&data.projects.some(p=>p.key===selected.key)?selected.key:"");
      const bugs=data.issueTypes.filter(t=>/bug|缺陷|故障/i.test(t.name));
      setIssueTypeIds(selected?selected.issueTypeIds.filter(id=>data.issueTypes.some(t=>t.id===id)):bugs.length===1?[bugs[0].id]:[]);
    }catch(e){setError(message(e));}finally{setBusy(false);}
  }
  async function save(event?: FormEvent) {
    event?.preventDefault();setBusy(true);setError("");setNotice("");
    try {
      let draft=buildDraft();
      if(draft.kind!=="trinity"){
        const selected=catalogue?.projects.find(p=>p.key===projectKey);
        if(!selected||!catalogue||!issueTypeIds.length)throw new Error("请先登录并读取 Jira 项目，选择此连接的项目与缺陷类型");
        draft={...draft,jiraProject:{...selected,owner:catalogue.owner,issueTypeIds}};
      }
      if (draft.kind !== "jira-cli" && !password && !(draft.kind==="trinity" && editingId && !autoLogin)) throw new Error("请输入登录密码");
      const saved = unwrap(
        await window.platform.saveIssueConnection(
          draft,
          draft.kind === "jira-cli" ? undefined : password,
          editingId,
        ),
      );
      setPassword("");
      await reload();
      setNotice(
        draft.kind === "trinity" ? "Trinity 已自动关联所有代码项目，后续新建项目也自动继承。预分析前会校验问题的项目映射。" : "Jira 连接及对应项目已保存，可直接关联代码项目。",
      );
      onSaved?.(saved);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel work-panel">
      {!embedded && <><span className="eyebrow">BUG PLATFORM LOGIN</span>
      <h2>Jira 与 Trinity 登录</h2></>}
      <p className="muted">
        Jira 每条连接对应一个 Jira 项目，可保存多条并在代码项目中更换。Trinity 只有一个当前账号，登录后自动关联所有代码项目。所有连接使用本地网络直连。
      </p>
      {error && (
        <div className="error-panel" role="alert">
          {error}
        </div>
      )}
      {notice && <div className="notice">{notice}</div>}
      {editingId && <p className="notice">正在编辑原连接。重新登录需输入密码；关闭 Trinity 自动登录时可留空。Trinity 重新登录会替换所有代码项目使用的当前账号。</p>}
      <Container
        onSubmit={(e) => void save(e)}
        onChangeCapture={() => {
          formEdited.current = true;
        }}
        className="connection-form"
      >
        <div className="form-row">
          {!embedded && <label>
            BUG 平台
            <select
              value={platform}
              onChange={(e) => {
                const value = e.target.value as typeof platform;
                setPlatform(value);
                setAutoLogin(false);
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
          </label>}
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
                本地配置账号：{local.username} · {local.baseUrl}
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
                required={!(platform==="trinity" && editingId && !autoLogin)}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {platform === "trinity" && <label className="checkbox-row"><input type="checkbox" disabled={busy} checked={autoLogin} onChange={e=>setAutoLogin(e.target.checked)} />在本机保存账号密码，并在启动时自动登录</label>}
            <p className="muted small">
              {platform === "trinity"
                ? "默认仅加密保存会话 token。勾选后通过系统加密保存账号密码，每次启动登录一次；关闭后清除保存的密码。自动登录失败会提示，不循环重试。"
                : "登录成功后在本机加密保存密码，不可读回；此方式用于支持账号密码认证的 Server / Data Center。Cloud 请使用本地 CLI 登录。"}
            </p>
          </>
        )}
        {platform==="jira" && <>
          <button type="button" className="secondary" disabled={busy||checking} onClick={()=>void discover()}>登录并读取 Jira 项目</button>
          <JiraProjectPicker projects={catalogue?.projects??[]} value={projectKey} disabled={!catalogue||busy} onChange={key=>setProjectKey(key??"")} />
          {catalogue && <><p className="muted small">负责人：{catalogue.owner}。每条连接仅保存所选的一个 Jira 项目。</p><label>缺陷类型<select multiple required value={issueTypeIds} onChange={e=>setIssueTypeIds(Array.from(e.target.selectedOptions,o=>o.value))}>{catalogue.issueTypes.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label></>}
        </>}
        {platform==="trinity" && <p className="notice">Trinity 为唯一账号连接，保存后自动关联已有及未来代码项目。项目映射仅用于判断能否进行 BUG 预分析。</p>}
        <button type={embedded ? "button" : "submit"} onClick={embedded ? () => void save() : undefined} className="primary" disabled={busy || checking}>
          {busy
            ? "正在登录并保存…"
            : editingId ? "保存连接修改"
            : platform === "jira" && jiraMode === "cli"
              ? "保存本地 Jira 连接"
              : platform === "jira" ? "保存 Jira 连接" : "登录并保存平台连接"}
        </button>
        {editingId && <button type="button" className="secondary" disabled={busy} onClick={addNew}>取消编辑 / 新增连接</button>}
      </Container>
      {!embedded && connections.map((c) => (
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
            {c.kind === "trinity" ? <p className="muted small">当前唯一账号 · 已自动关联所有代码项目 · 自动登录{c.autoLogin ? "已开启" : "未开启"}{!c.accountId && " · 请重新登录验证身份"}</p> : <p className="muted small">Jira 项目：{c.jiraProject ? `${c.jiraProject.name}（${c.jiraProject.key}）` : "旧连接尚未配置，请编辑并选择 Jira 项目"}</p>}
          </div>
          <button className="secondary" disabled={busy || checking} onClick={() => edit(c)}>编辑 / 重新登录</button>
          {c.platform !== "trinity" && onLink && <button className="secondary" disabled={busy} onClick={() => onLink(c)}>关联项目</button>}
          <button
            disabled={busy}
            className="text-button danger-text"
            onClick={() => {
              setBusy(true);
              setError("");
              setNotice("");
              void window.platform
                .deleteIssueConnection(c.id)
                .then((r) => {
                  unwrap(r);
                  return reload();
                })
                .then(() => {
                  if (editingId === c.id) addNew();
                  setNotice("平台连接已删除，所有代码项目的对应关联已解除；代码项目和历史材料已保留。");
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
