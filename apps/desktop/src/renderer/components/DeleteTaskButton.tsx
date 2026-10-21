import {useState} from "react";
import {ACTIVE_TASK_STATUSES,type Task} from "../../../../../packages/contracts/src/models";
import {message,unwrap} from "../api";
export function DeleteTaskButton({task,onDeleted}:{task:Task;onDeleted:()=>Promise<void>}){
 const [confirm,setConfirm]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState("");
 if(ACTIVE_TASK_STATUSES.includes(task.status))return null;
 return <><button className="text-button danger-text" onClick={()=>setConfirm(true)}>删除记录</button>{confirm&&<div className="modal-backdrop"><section className="editor modal" role="dialog" aria-modal="true" aria-label="删除任务记录"><h2>删除任务记录</h2><p>删除 {task.issueKey??task.projectName} 的这条任务记录？仅从列表移除，已有报告、代码和日志文件将保留。</p>{error&&<p role="alert" className="error-panel">{error}</p>}<div className="form-footer"><button disabled={busy} className="secondary" onClick={()=>setConfirm(false)}>保留记录</button><button disabled={busy} className="primary" onClick={()=>{setBusy(true);setError("");void(async()=>{try{unwrap(await window.platform.deleteTask(task.id));await onDeleted();setConfirm(false);}catch(e){setError(message(e));}finally{setBusy(false);}})();}}>确认删除记录</button></div></section></div>}</>;
}
