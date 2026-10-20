import { useEffect, useId, useState } from "react";
import type { Project } from "../../../../../packages/contracts/src/models";
import type { PublicIssueConnection } from "../../../../../packages/contracts/src/issues";
import { message, unwrap } from "../api";
type Mapping=NonNullable<Project["trinityProjects"]>[number];
const sameInstance=(a:string,b:string)=>new URL(a).href.replace(/\/$/,"")===new URL(b).href.replace(/\/$/,"");
export function TrinityProjectPicker({connection,mappings,disabled,onChange}:{connection:PublicIssueConnection;mappings:Mapping[];disabled:boolean;onChange:(mappings:Mapping[])=>void}) {
 const [projects,setProjects]=useState<Mapping[]>([]);
 const [query,setQuery]=useState("");const [focused,setFocused]=useState(false);
 const [loading,setLoading]=useState(false);const [loaded,setLoaded]=useState(false);const [error,setError]=useState("");
 const listId=useId();
 useEffect(()=>{setProjects([]);setLoaded(false);setQuery("");},[connection.id,connection.baseUrl]);
 const selected=mappings.filter(m=>sameInstance(m.instanceUrl,connection.baseUrl));
 const keyword=query.trim().toLocaleLowerCase();
 const matches=projects.filter(p=>!selected.some(m=>m.projectId===p.projectId)&&`${p.name??""} ${p.projectId}`.toLocaleLowerCase().includes(keyword));
 async function load(){
  setLoading(true);setError("");
  try{setProjects(unwrap(await window.platform.getTrinityProjects(connection.id)));setLoaded(true);}
  catch(e){setError(message(e));setProjects([]);setLoaded(false);}
  finally{setLoading(false);}
 }
 return <div className="binding-form">
  <h3>Trinity 账号 · 自动关联</h3>
  <p>{connection.name}。账号问题自动应用于所有代码项目；以下映射决定本代码项目可分析哪些 Trinity 项目。</p>
  <button type="button" className="secondary" disabled={disabled||loading} onClick={()=>void load()}>{loading?"正在读取 Trinity 项目…":"读取 Trinity 项目"}</button>
  <p className="muted small">从当前账号负责的问题中提取项目，读取不发送通知。可选择多个项目，同一 Trinity 项目也可关联多个代码项目。无问题的项目暂不在列表内；未返回名称时显示项目 ID。</p>
  <label>搜索 Trinity 项目<input role="combobox" aria-autocomplete="list" aria-expanded={focused&&loaded} aria-controls={listId} value={query} disabled={disabled||loading||!loaded} placeholder="先读取项目，再按名称或 ID 搜索" onFocus={()=>setFocused(true)} onChange={e=>{setQuery(e.target.value);setFocused(true);}} onKeyDown={e=>{if(e.key==="Escape")setFocused(false);}} /></label>
  {loaded&&focused&&<div id={listId} role="listbox" aria-label="Trinity 项目搜索结果">
   {matches.slice(0,50).map(p=><button type="button" className="secondary" role="option" aria-selected={false} key={p.projectId} disabled={disabled} onClick={()=>{onChange([...mappings,p]);setQuery("");setFocused(false);}}>{p.name??"未返回项目名称"}（{p.projectId}）</button>)}
   {!matches.length&&<p className="muted small">没有可添加的匹配项目，请调整搜索或刷新问题后重新读取。</p>}
   {matches.length>50&&<p className="muted small">匹配超过 50 项，请输入更准确的名称或 ID。</p>}
  </div>}
  <div aria-label="已关联 Trinity 项目">{selected.map(m=><div className="report-list-item" key={m.projectId}><span>{m.name??projects.find(p=>p.projectId===m.projectId)?.name??"未返回项目名称"}（{m.projectId}）</span><button type="button" className="text-button" disabled={disabled} onClick={()=>onChange(mappings.filter(p=>!(sameInstance(p.instanceUrl,m.instanceUrl)&&p.projectId===m.projectId)))}>移除映射</button></div>)}</div>
  {error&&<div className="error-panel" role="alert">{error}</div>}
 </div>;
}
