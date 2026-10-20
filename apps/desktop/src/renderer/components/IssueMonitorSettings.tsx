import { useEffect, useState } from "react";
import type { IssueMonitorConfiguration, IssueMonitorStatus, NotificationRecipientSearch } from "../../../../../packages/contracts/src/issue-monitor";
import { message, unwrap } from "../api";

export function IssueMonitorSettings({ onConfigure }: { onConfigure: () => void }) {
  const [status, setStatus] = useState<IssueMonitorStatus | null>(null);
  const [draft, setDraft] = useState<IssueMonitorConfiguration | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [query,setQuery]=useState("");
  const [results,setResults]=useState<NotificationRecipientSearch|null>(null);
  const [selected,setSelected]=useState("");
  useEffect(() => {
    let live = true;
    let reading = false;
    async function load() {
      if (reading) return;
      reading = true;
      try {
        const next = unwrap(await window.platform.getIssueMonitor());
        if (live) { setStatus(next); setDraft(previous => previous ?? next.configuration); }
      } catch (e) { if (live) setError(message(e)); }
      finally { reading = false; }
    }
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => { live = false; clearInterval(timer); };
  }, []);
  async function act(action: () => Promise<IssueMonitorStatus>, text: string) {
    setBusy(true); setError(""); setNotice("");
    try { setStatus(await action()); setNotice(text); }
    catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }
  async function search() {
    setBusy(true);setError("");setNotice("");setResults(null);setSelected("");
    try {setResults(unwrap(await window.platform.searchNotificationRecipients(query)));}
    catch(e){setError(message(e));}
    finally{setBusy(false);}
  }
  const problem = error || (status?.notificationError ? `${status.notificationError.code}：${status.notificationError.message}` : status?.runtimeError?.message);
  return <><details className="config-details">
    <summary>定时查询与飞书提醒 · {status?.configuration.enabled ? "已开启" : "已暂停"}{status?.pendingCount ? ` · 待发送 ${status.pendingCount} 条` : ""}{problem ? " · 通知异常" : ""}</summary>
    <p className="muted small">首次成功读取作为基线，后续只提醒新出现的问题。应用运行或驻留托盘时查询；退出或休眠期间无法实时提醒。通过飞书机器人向已保存的账号发私信。姓名搜索需要用户授权；保存后发送不再查询 CLI 当前用户，仍需机器人发消息权限。</p>
    {draft && <>
      <label className="check-label"><input type="checkbox" checked={draft.enabled} onChange={e => setDraft({ ...draft, enabled: e.target.checked })} />定时查询新问题</label>
      <label>查询间隔（分钟）<input type="number" min={1} max={1440} value={draft.intervalMinutes} onChange={e => setDraft({ ...draft, intervalMinutes: e.target.valueAsNumber })} /></label>
      <label className="check-label"><input type="checkbox" checked={draft.notificationsEnabled} onChange={e => setDraft({ ...draft, notificationsEnabled: e.target.checked })} />飞书通知已保存的接收人</label>
      <label>飞书接收人姓名<input maxLength={50} value={query} disabled={busy} placeholder="输入姓名，搜索后选择对应账号" onChange={e=>{setQuery(e.target.value);setResults(null);setSelected("");}} /></label>
      <button className="secondary" disabled={busy||!query.trim()} onClick={()=>void search()}>搜索接收人</button>
      {results && <div role="group" aria-label="飞书接收人搜索结果">
        {!results.users.length && <p className="muted small">没有找到匹配账号，请调整姓名后重试。</p>}
        {results.users.map(user=><label className="check-label" key={user.openId}><input type="radio" name="notification-recipient" disabled={busy} checked={selected===user.openId} onChange={()=>setSelected(user.openId)} />{user.name} · {user.department||"未提供部门"} · {user.openId}</label>)}
        {results.hasMore && <p className="notice">还有更多匹配账号，请使用更准确的姓名缩小范围。</p>}
        <button className="secondary" disabled={busy||!selected} onClick={()=>void act(async()=>unwrap(await window.platform.saveNotificationRecipient(selected)),"飞书接收人已保存；后续通知直接发送至该账号，不再检查 CLI 当前用户。本次未发送消息。")}>保存飞书接收人</button>
      </div>}
      <p className="muted small">保存接收人后，待发送及后续的新问题通知将发给该账号。搜索和保存操作不会发送测试消息。</p>
      <div className="row-actions">
        <button className="secondary" disabled={busy} onClick={() => void act(async () => unwrap(await window.platform.saveIssueMonitor(draft)), "监控设置已保存。")}>保存监控设置</button>
        <button className="secondary" disabled={busy} onClick={() => void act(async () => unwrap(await window.platform.checkIssueNotifications()), "已将 CLI 当前用户保存为接收人；后续直接发送，本次未发送消息。")}>使用当前 CLI 用户</button>
        <button className="secondary" onClick={onConfigure}>配置飞书 CLI</button>
      </div>
    </>}
    <p className="muted small">{status?.recipient ? `通知接收人：${status.recipient.name} · ${status.recipient.department||"未提供部门"} · ${status.recipient.openId}` : "飞书接收人尚未保存，请搜索并选择账号，或使用当前 CLI 用户。"} · 待发送 {status?.pendingCount ?? 0} 条{status?.lastNotificationAt && ` · 最近发送 ${new Date(status.lastNotificationAt).toLocaleString()}`}</p>
    {notice && <p className="notice">{notice}</p>}
  </details>
  {problem && <div className="error-panel" role="alert">{problem}</div>}
  </>;
}
