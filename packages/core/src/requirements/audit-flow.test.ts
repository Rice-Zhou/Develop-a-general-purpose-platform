import {it,expect,vi} from "vitest";
import type {Task,ContextSnapshot} from "../../../contracts/src/models";
vi.mock("../analysis/analysis-pipeline",()=>({AnalysisPipeline:class{async extract(){return {id:"set",revision:1,items:[]};}async check(){return {id:"report"};}}}));
import {Workbench} from "../../../../apps/desktop/src/service/workbench";
it("orchestrates extraction and checking as one audit result",async()=>{
 const project={id:"p",enabled:true,revision:1,aiProfileId:"ai"};
 const w=Object.assign(Object.create(Workbench.prototype),{store:{getProject:()=>project,latestRequirementSet:()=>null},configurationHash:()=>"hash",profile:()=>({}),transport:async()=>({}),bound:()=>({})}) as Workbench;
 const result=await w.analyze({kind:"AUDIT_REQUIREMENTS",projectId:"p",projectRevision:1,executionConfigurationHash:"hash"} as Task,{configRevision:1,documents:[],repositories:[]} as unknown as ContextSnapshot,new AbortController().signal,()=>{});
 expect(result).toMatchObject({kind:"requirement-audit",set:{id:"set"},report:{id:"report"}});
});

it("rejects missing AI before enqueueing any audit",async()=>{
 const enqueue=vi.fn();const w=Object.assign(Object.create(Workbench.prototype),{store:{getProject:()=>({id:"p",aiProfileId:null})}}) as Workbench;
 await expect(w.dispatch({method:"auditRequirements",params:{projectId:"p"}},{enqueue} as never)).rejects.toMatchObject({code:"MODEL_NOT_CONFIGURED"});expect(enqueue).not.toHaveBeenCalled();
});
