import type {IssueListItem} from "../../../../../packages/contracts/src/issue-monitor";
import {unwrap} from "../api";
export function IssueLogMaterials({issue,projectId,busy,onAction,onPreview}:{issue:IssueListItem;projectId:string;busy:boolean;onAction:(action:()=>Promise<unknown>,notice?:string)=>Promise<void>;onPreview:(text:string)=>void}) {
  return (
<div className="notice small">
              日志材料：{issue.logs ? ({QUEUED:"排队等待下载",DOWNLOADING:"正在下载并解析",READY:"已下载并解析",NO_LOGS:"平台确认无附件",FAILED:"下载或解析失败",UNSUPPORTED:"当前连接或附件格式暂不支持"}[issue.logs.status]) : "尚未准备，请刷新问题"}
              {issue.logs && <p>已保存附件 {issue.logs.files.filter(file=>file.error === "附件原件").length} / {issue.logs.attachments.length}</p>}
              {issue.logs?.error&&<p className="coverage-warning">{issue.logs.error}</p>}
              {issue.logs?.files.filter(file=>file.error==="附件原件").map(file=><p key={file.id}>{file.path} · {file.size.toLocaleString()} 字节 <button className="text-button" onClick={()=>void onAction(async()=>unwrap(await window.platform.openIssueMaterial(projectId,issue.id,file.id)))}>定位附件原件</button></p>)}
              {issue.logs?.files.filter(file=>file.status==="PARSED").map(file=><p key={file.id}>{file.path} · {file.lineCount} 行 <button className="text-button" onClick={()=>void onAction(async()=>{const value=unwrap(await window.platform.readIssueLog(projectId,issue.id,file.id));onPreview(value.text+(value.truncated?"\n（仅预览前 100 行，AI 可按范围继续读取）":""));})}>查看日志</button></p>)}
              <button className="secondary" disabled={busy} onClick={()=>void onAction(async()=>unwrap(await window.platform.retryIssueLogs(projectId,issue.id)),"日志下载已重新排队。")}>重试日志下载</button>
            </div>
  );
}
