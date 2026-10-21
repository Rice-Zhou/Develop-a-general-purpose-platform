import {expect,it,vi} from "vitest";
import {Workbench} from "./workbench";
const id="a978b21c-8bd5-4dbd-89e7-642bf4b500a4";
const draft={kind:"codex" as const,name:"Codex",executable:"D:/latest/codex.exe",model:"available",outboundEnabled:true};
it("rechecks latest executable and account model before mutating connection settings",async()=>{
 const setSetting=vi.fn();const setDefaultAIProfile=vi.fn();
 const discoverCodex=vi.fn(async()=>({selected:{executable:draft.executable,version:"1.0.0"},candidates:[],models:[{id:"available",name:"Available",isDefault:true}],planType:"pro"}));
 const runtime=Object.assign(Object.create(Workbench.prototype),{store:{setSetting,setDefaultAIProfile,getDefaultAIProfile:()=>id},profiles:()=>[{...draft,id,credentialRef:null}],discoverCodex}) as Workbench;
 await expect(runtime.saveProfile({id,credentialRef:null,draft:{...draft,executable:"D:/old/codex.exe"}})).rejects.toMatchObject({code:"CODEX_SELECTION_CHANGED"});expect(setSetting).not.toHaveBeenCalled();
 await expect(runtime.saveProfile({id,credentialRef:null,draft:{...draft,model:"unlisted"}})).rejects.toMatchObject({code:"CODEX_MODEL_UNAVAILABLE"});expect(setSetting).not.toHaveBeenCalled();
 expect(await runtime.saveProfile({id,credentialRef:null,draft})).toMatchObject({id,model:"available",executable:draft.executable});expect(setDefaultAIProfile).not.toHaveBeenCalled();expect(setSetting).toHaveBeenCalledWith("profiles",[{...draft,id,credentialRef:null}]);
});
