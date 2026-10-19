import { useEffect, useState } from "react";
import type { IssueMonitorConfiguration, IssueMonitorStatus } from "../../../../../packages/contracts/src/issue-monitor";
import { message, unwrap } from "../api";

export function IssueMonitorSettings({ onConfigure }: { onConfigure: () => void }) {
  const [status, setStatus] = useState<IssueMonitorStatus | null>(null);
  const [draft, setDraft] = useState<IssueMonitorConfiguration | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
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
  const problem = error || (status?.notificationError ? `${status.notificationError.code}：${status.notificationError.message}` : status?.runtimeError?.message);
  return <><details className="config-details">
    <summary>定时查询与飞书提醒 · {status?.configuration.enabled ? "已开启" : "已暂停"}{status?.pendingCount ? ` · 待发送 ${status.pendingCount} 条` : ""}{problem ? " · 通知异常" : ""}</summary>
    <p className="muted small">首次成功读取作为基线，后续只提醒新出现的问题。应用运行或驻留托盘时查询；退出或休眠期间无法实时提醒。通过当前飞书应用机器人给 CLI 登录用户发私信，需要用户授权和机器人发消息权限。</p>
    {draft && <>
      <label className="check-label"><input type="checkbox" checked={draft.enabled} onChange={e => setDraft({ ...draft, enabled: e.target.checked })} />定时查询新问题</label>
      <label>查询间隔（分钟）<input type="number" min={1} max={1440} value={draft.intervalMinutes} onChange={e => setDraft({ ...draft, intervalMinutes: e.target.valueAsNumber })} /></label>
      <label className="check-label"><input type="checkbox" checked={draft.notificationsEnabled} onChange={e => setDraft({ ...draft, notificationsEnabled: e.target.checked })} />飞书通知本机用户</label>
      <div className="row-actions">
        <button className="secondary" disabled={busy} onClick={() => void act(async () => unwrap(await window.platform.saveIssueMonitor(draft)), "监控设置已保存。")}>保存监控设置</button>
        <button className="secondary" disabled={busy} onClick={() => void act(async () => unwrap(await window.platform.checkIssueNotifications()), "已确认飞书接收人；本次检查不会发送消息。")}>检查飞书接收人</button>
        <button className="secondary" onClick={onConfigure}>配置飞书 CLI</button>
      </div>
    </>}
    <p className="muted small">{status?.recipient ? `通知接收人：${status.recipient.name}` : "飞书接收人尚未确认，请检查 CLI 登录用户。"} · 待发送 {status?.pendingCount ?? 0} 条{status?.lastNotificationAt && ` · 最近发送 ${new Date(status.lastNotificationAt).toLocaleString()}`}</p>
    {notice && <p className="notice">{notice}</p>}
  </details>
  {problem && <div className="error-panel" role="alert">{problem}</div>}
  </>;
}
