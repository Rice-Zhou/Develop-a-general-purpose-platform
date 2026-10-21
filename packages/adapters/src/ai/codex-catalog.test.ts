import {expect,it,vi} from "vitest";
import {readCodexCatalogue} from "./codex-catalog";
it("uses account metadata and paginated model/list, excludes hidden models without invoking inference",async()=>{
 const request=vi.fn(async(method:string,params:unknown)=>method==="account/read"?{account:{type:"chatgpt",planType:"pro"}}:(params as {cursor?:string}).cursor?{data:[{model:"b",displayName:"B",hidden:false,isDefault:false}],nextCursor:null}:{data:[{model:"a",displayName:"A",hidden:false,isDefault:true},{model:"internal",displayName:"internal",hidden:true,isDefault:false}],nextCursor:"next"});
 const result=await readCodexCatalogue(request);
 expect(result.models.map(m=>m.id)).toEqual(["a","b"]);expect(result.models[0].isDefault).toBe(true);expect(result.planType).toBe("pro");expect(request.mock.calls.map(c=>c[0])).toEqual(["account/read","model/list","model/list"]);
});
it("requires a logged-in ChatGPT identity and refuses cyclic pagination or malformed catalogues",async()=>{
 await expect(readCodexCatalogue(async()=>({account:null}))).rejects.toMatchObject({code:"CODEX_LOGIN_REQUIRED"});
 await expect(readCodexCatalogue(async(method)=>method==="account/read"?{account:{type:"chatgpt"}}:{data:[],nextCursor:"same"})).rejects.toMatchObject({code:"CODEX_CATALOG_INVALID"});
 await expect(readCodexCatalogue(async(method)=>method==="account/read"?{account:{type:"chatgpt"}}:{data:[{model:"",displayName:""}],nextCursor:null})).rejects.toMatchObject({code:"CODEX_CATALOG_INVALID"});
});
