import { useEffect, useRef, useState } from "react";
import type { JiraCatalogue, PublicIssueConnection } from "../../../../../packages/contracts/src/issues";
import type { Project } from "../../../../../packages/contracts/src/models";
import { message, unwrap } from "../api";
import { IssueConnectionsPage } from "../pages/IssueConnectionsPage";
import { JiraProjectPicker } from "./JiraProjectPicker";

type Binding = Project["issueBindings"][number];
export function JiraProjectField({ binding, connections, onConnectionSaved, onChange, onReadinessChange }: {
  binding?: Binding;
  connections: PublicIssueConnection[];
  onConnectionSaved: (connection: PublicIssueConnection) => void;
  onChange: (binding: Binding | null) => void;
  onReadinessChange: (ready: boolean) => void;
}) {
  const [connectionId, setConnectionId] = useState(binding?.connectionId ?? "");
  const [catalogue, setCatalogue] = useState<JiraCatalogue | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const bindingRef = useRef(binding);
  bindingRef.current = binding;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const connection = connections.find((c) => c.id === connectionId);
  function select(key: string, data: JiraCatalogue, types?: string[]) {
    if (!key || !connection) { onChangeRef.current(null); return; }
    const candidates = data.issueTypes.filter((t) => /bug|缺陷|故障/i.test(t.name));
    const issueTypeIds = types ?? (candidates.length === 1 ? [candidates[0].id] : []);
    onChangeRef.current({ id: bindingRef.current?.id ?? crypto.randomUUID(), connectionId, instanceUrl: connection.baseUrl, platform: connection.platform, projectKey: key, owner: data.owner, issueTypeIds });
  }
  async function load() {
    const request = ++sequence.current;
    setCatalogue(null); setError(""); setLoading(true); onReadinessChange(false);
    try {
      const next = unwrap(await window.platform.getJiraCatalogue(connectionId));
      if (request !== sequence.current) return;
      setCatalogue(next);
      onReadinessChange(true);
      const previous = bindingRef.current;
      if (previous?.connectionId === connectionId && next.projects.some((p) => p.key === previous.projectKey)) {
        const types = previous.issueTypeIds?.filter((id) => next.issueTypes.some((t) => t.id === id));
        select(previous.projectKey, next, types?.length ? types : undefined);
      } else onChangeRef.current(null);
    } catch (e) { if (request === sequence.current) setError(message(e)); }
    finally { if (request === sequence.current) setLoading(false); }
  }
  useEffect(() => {
    if (connection) void load();
    else { setCatalogue(null); setError(""); setLoading(false); onReadinessChange(false); }
    return () => { sequence.current++; };
    // A login choice owns its response; editing a project name must not refetch.
  }, [connectionId, connection]);
  return <div className="binding-form">
    <label>Jira 登录连接<select value={connectionId} onChange={(e) => { sequence.current++; setConnectionId(e.target.value); onReadinessChange(false); onChange(null); }}>
      <option value="">添加登录连接</option>
      {connections.filter((c) => c.platform !== "trinity").map((c) => <option key={c.id} value={c.id}>{c.name} · {c.kind === "jira-cli" ? "Jira CLI" : "账号登录"}</option>)}
    </select></label>
    {!connectionId && <IssueConnectionsPage embedded onSaved={(saved) => { onConnectionSaved(saved); setConnectionId(saved.id); }} />}
    {connectionId && <>
      <button type="button" className="secondary" disabled={loading || !connection} onClick={() => void load()}>刷新 Jira 项目列表</button>
      {loading && <p role="status">正在读取登录身份与可访问的 Jira 项目…</p>}
      {error && <div className="error-panel" role="alert">{error}</div>}
      <JiraProjectPicker key={connectionId} projects={catalogue?.projects ?? []} value={binding?.projectKey} disabled={!catalogue || loading} onChange={(key) => {
        if (key && catalogue) select(key, catalogue);
        else onChange(null);
      }} />
      {catalogue && <>
        {catalogue.owner && <p className="muted small">仅接收分配给 {catalogue.owner} 的问题</p>}
        {!catalogue.projects.length && <p role="status">当前登录账号没有可访问的 Jira 项目。</p>}
        {catalogue.typeSource === "cli-config" && <p className="muted small">类型来自本地 Jira CLI 配置；请确认配置已更新。读取问题时仍会校验实际项目、负责人和类型。</p>}
        {binding && <label>缺陷类型<select multiple required value={binding.issueTypeIds ?? []} onChange={(e) => select(binding.projectKey, catalogue, Array.from(e.target.selectedOptions, (option) => option.value))}>
          {catalogue.issueTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select></label>}
      </>}
    </>}
  </div>;
}
