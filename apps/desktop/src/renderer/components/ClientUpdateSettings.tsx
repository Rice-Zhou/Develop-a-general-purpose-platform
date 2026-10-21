import type {UpdateStatus} from "../../../../../packages/contracts/src/updates";
export function ClientUpdateControls({status,onAction,onViewTasks}:{status:UpdateStatus;onAction:(action:"check"|"download"|"cancel"|"install"|"restart")=>void;onViewTasks:()=>void}){
 const labels:Record<UpdateStatus["phase"],string>={idle:"尚未检查",checking:"正在检查更新…","up-to-date":"当前已是最新版本",unavailable:"更新源尚无正式 Release",available:"发现可用新版本",downloading:"正在下载更新…",ready:"更新包已校验，可以安装",installing:"正在准备安装…",error:"更新操作失败"};
 const busy=["checking","downloading","installing"].includes(status.phase);
 return <><p>当前版本 {status.currentVersion} · {labels[status.phase]}{status.offer&&` · 新版本 ${status.offer.version}`}</p>
  {status.installationMode==="portable"&&<p className="notice">便携版更新后转为安装版，现有配置保留。</p>}
  {status.offer&&<pre className="release-notes">{status.offer.notes||"此版本未提供更新说明。"}</pre>}
  {status.phase==="downloading"&&<div><progress max={status.offer?.manifest.size??1} value={status.receivedBytes}/><span> {status.receivedBytes.toLocaleString()} / {status.offer?.manifest.size.toLocaleString()} 字节</span></div>}
  {status.error&&<div role="alert" className="error-panel">{status.error.code}：{status.error.message}{status.error.code==="UPDATE_TASKS_ACTIVE"&&<button className="text-button" onClick={onViewTasks}>前往任务列表</button>}</div>}
  <div className="row-actions">{status.restartRequired?<button className="primary" onClick={()=>onAction("restart")}>重启客户端恢复</button>:<>
   <button className="secondary" disabled={busy} onClick={()=>onAction("check")}>检查更新</button>
   {status.offer&&["available","error"].includes(status.phase)&&<button className="primary" onClick={()=>onAction("download")}>下载更新</button>}
   {status.phase==="downloading"&&<button className="secondary" onClick={()=>onAction("cancel")}>取消下载</button>}
   {status.phase==="ready"&&<button className="primary" onClick={()=>onAction("install")}>安装并重启</button>}
  </>}</div></>;
}
export function ClientUpdateSettings(props:Parameters<typeof ClientUpdateControls>[0]){return <section className="panel settings-panel"><h2>客户端更新</h2><p className="muted small">更新来源：公开 GitHub Release · Rice-Zhou/Develop-a-general-purpose-platform</p><ClientUpdateControls {...props}/></section>;}
