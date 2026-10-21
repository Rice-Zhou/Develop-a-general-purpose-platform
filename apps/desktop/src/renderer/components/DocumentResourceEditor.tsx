import {useEffect,useState,type FormEvent} from "react";
import {createPortal} from "react-dom";
import type {DocumentResource} from "../../../../../packages/contracts/src/models";
import {isDocumentResource,type LibraryResource,type LibraryCategory} from "../../../../../packages/contracts/src/library";
import {message,unwrap} from "../api";
export function DocumentResourceEditor({resource,onSaved,onClose,categoryId=null,documentsOnly=true}:{resource?:DocumentResource|LibraryResource;onSaved:(r:DocumentResource)=>void;onClose:()=>void;categoryId?:string|null;documentsOnly?:boolean}){
 const [name,setName]=useState(resource?.name??"");const [kind,setKind]=useState<LibraryResource["kind"]>(resource?.kind??"docx");
 const [locator,setLocator]=useState(resource&&"locator" in resource?resource.locator:"");const [text,setText]=useState(resource&&"text" in resource?resource.text:"");
 const [category,setCategory]=useState(resource&&"categoryId" in resource?resource.categoryId:categoryId);const [categories,setCategories]=useState<LibraryCategory[]>([]);
 const [purpose,setPurpose]=useState<LibraryResource["purpose"]>(resource&&"purpose" in resource?resource.purpose:"requirement");const [notes,setNotes]=useState(resource&&"notes" in resource?resource.notes:"");
 const [required,setRequired]=useState(resource?.required??true);const [busy,setBusy]=useState(false);const [error,setError]=useState("");
 useEffect(()=>{let active=true;void window.platform.getLibrary().then(unwrap).then(v=>{if(active)setCategories(v.categories);}).catch(e=>{if(active)setError(message(e));});return()=>{active=false;};},[]);
 async function save(e:FormEvent){e.preventDefault();e.stopPropagation();setBusy(true);setError("");try{const r=unwrap(await window.platform.saveLibraryResource({...(resource?{id:resource.id}:{}),name,categoryId:category,purpose,notes,required,...(kind==="note"?{kind,text}:{kind,locator})},resource?.revision));
 // Library callers reload all kinds; legacy document pickers restrict the editor to parseable kinds.
 if(isDocumentResource(r))onSaved({id:r.id,name:r.name,kind:r.kind,locator:r.locator,required:r.required,revision:r.revision});else onClose();
 }catch(e){setError(message(e));}finally{setBusy(false);}}
 return createPortal(<div className="modal-backdrop"><section className="editor modal" role="dialog" aria-modal="true" aria-labelledby="document-resource-title"><h2 id="document-resource-title">{resource?"编辑需求文档资源":"添加需求文档资源"}</h2><form onSubmit={e=>void save(e)}>
 <label>需求文档名称<input required value={name} onChange={e=>setName(e.target.value)}/></label>
 <label>文档类型<select aria-label="文档类型" value={kind} onChange={e=>setKind(e.target.value as typeof kind)}><option value="docx">Word .docx</option><option value="pdf">PDF</option><option value="feishu">飞书文档</option>{!documentsOnly&&<><option value="url">网页 / UI / UE 链接（参考）</option><option value="path">文件或目录路径（参考）</option><option value="note">文本说明（参考）</option></>}</select></label>
 {kind==="note"?<label>资料文本<textarea required value={text} onChange={e=>setText(e.target.value)}/></label>:<label>文档路径或链接<input required value={locator} onChange={e=>setLocator(e.target.value)}/></label>}
 <label>所属分类<select value={category??""} onChange={e=>setCategory(e.target.value||null)}><option value="">未分类</option>{categories.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select></label>
 <label>资料用途<select value={purpose} onChange={e=>setPurpose(e.target.value as typeof purpose)}><option value="requirement">需求</option><option value="ui">UI</option><option value="ue">UE</option><option value="general">通用资料</option></select></label>
 <label>备注<textarea value={notes} onChange={e=>setNotes(e.target.value)}/></label>
 {["docx","pdf","feishu"].includes(kind)&&<label className="check-label"><input type="checkbox" checked={required} onChange={e=>setRequired(e.target.checked)}/>默认作为必需文档</label>}
 <p className="muted small">可独立保存并随后关联项目。通用链接、路径和文本仅作参考，不自动解析需求。</p>{error&&<div className="error-panel" role="alert">{error}</div>}
 <div className="form-footer"><button type="button" className="secondary" disabled={busy} onClick={onClose}>取消</button><button className="primary" disabled={busy}>保存需求文档资源</button></div></form></section></div>,document.body);
}
