import { useEffect, useRef, useState } from "react";
import type { PublicIssueConnection } from "../../../../../packages/contracts/src/issues";
import type { Project } from "../../../../../packages/contracts/src/models";
import { IssueConnectionsPage } from "../pages/IssueConnectionsPage";
type Binding=Project["issueBindings"][number];
export function JiraProjectField({binding,connections,onConnectionSaved,onChange,initialConnectionId}: {
 initialConnectionId?:string;binding?:Binding;connections:PublicIssueConnection[];onConnectionSaved:(connection:PublicIssueConnection)=>void;onChange:(binding:Binding|null)=>void;
}) {
 const [connectionId,setConnectionId]=useState(initialConnectionId??binding?.connectionId??"");
 const change=useRef(onChange);change.current=onChange;
 const original=useRef(binding);original.current=binding;
 const connection=connections.find(c=>c.id===connectionId&&c.kind!=="trinity");
 useEffect(()=>{
  if(connection&&connection.kind!=="trinity"&&connection.jiraProject){const p=connection.jiraProject;change.current({id:original.current?.id??crypto.randomUUID(),connectionId:connection.id,platform:connection.platform,instanceUrl:connection.baseUrl,projectKey:p.key,owner:p.owner,issueTypeIds:p.issueTypeIds});}
 },[connection]);
 return <div className="binding-form">
  <label>Jira 项目连接<select value={connectionId} onChange={e=>{setConnectionId(e.target.value);onChange(null);}}><option value="">添加 Jira 项目连接</option>
   {connectionId&&!connection&&<option value={connectionId} disabled>原关联已失效，请重新选择</option>}
   {connections.filter(c=>c.kind!=="trinity").map(c=><option key={c.id} value={c.id}>{c.name}{c.jiraProject?` · ${c.jiraProject.name}（${c.jiraProject.key}）`:" · 待配置 Jira 项目"}</option>)}
  </select></label>
  {connectionId&&!connection&&<div className="error-panel" role="alert">原 Jira 连接已不存在，请选择已有连接或添加连接。</div>}
  {connection&&connection.kind!=="trinity"&&(connection.jiraProject?<p className="muted small">已配置项目：{connection.jiraProject.name}（{connection.jiraProject.key}） · 负责人：{connection.jiraProject.owner}。切换连接即可更换 Jira 项目。</p>:<p className="error-panel" role="alert">请先在设置编辑此连接，登录并选择 Jira 项目后再关联。</p>)}
  {!connectionId&&<IssueConnectionsPage embedded onSaved={saved=>{onConnectionSaved(saved);setConnectionId(saved.id);}}/>}
 </div>;
}
