import {expect,it,vi} from "vitest";
import {readCodexCatalogue} from "./codex-catalog";
it("uses account metadata and paginated model/list, excludes hidden models without invoking inference",async()=>{
 const request=vi.fn(async(method:string,params:unknown)=>method==="account/read"?{account:{type:"chatgpt",planType:"pro"}}:method==="config/read"?{config:{chatgpt_base_url:"https://chatgpt.com/backend-api/"}}:(params as {cursor?:string}).cursor?{data:[{model:"b",displayName:"B",hidden:false,isDefault:false}],nextCursor:null}:{data:[{model:"a",displayName:"A",hidden:false,isDefault:true},{model:"internal",displayName:"internal",hidden:true,isDefault:false}],nextCursor:"next"});
 const result=await readCodexCatalogue(request);
 expect(result.models.map(m=>m.id)).toEqual(["a","b"]);expect(result.models[0].isDefault).toBe(true);expect(result.planType).toBe("pro");expect(request.mock.calls.map(c=>c[0])).toEqual(["account/read","config/read","model/list","model/list"]);
});
it("requires a logged-in ChatGPT identity and refuses cyclic pagination or malformed catalogues",async()=>{
 await expect(readCodexCatalogue(async()=>({account:null}))).rejects.toMatchObject({code:"CODEX_LOGIN_REQUIRED"});
 await expect(readCodexCatalogue(async(method)=>method==="account/read"?{account:{type:"chatgpt"}}:method==="config/read"?{config:{}}:{data:[],nextCursor:"same"})).rejects.toMatchObject({code:"CODEX_CATALOG_INVALID"});
 await expect(readCodexCatalogue(async(method)=>method==="account/read"?{account:{type:"chatgpt"}}:method==="config/read"?{config:{}}:{data:[{model:"",displayName:""}],nextCursor:null})).rejects.toMatchObject({code:"CODEX_CATALOG_INVALID"});
});
it("rejects a user custom catalogue before accepting its model/list as isolated execution models",async()=>{
 const request=vi.fn(async(method:string)=>method==="config/read"?{config:{model_catalog_json:"private-models.json"}}:method==="account/read"?{account:{type:"chatgpt",planType:"pro"}}:{data:[{model:"private-only",displayName:"Private",isDefault:true}],nextCursor:null});
 await expect(readCodexCatalogue(request)).rejects.toMatchObject({code:"CODEX_CONFIG_INCOMPATIBLE"});
 expect(request.mock.calls.some(call=>call[0]==="model/list")).toBe(false);
});
