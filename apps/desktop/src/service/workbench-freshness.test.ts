import {expect,it,vi} from "vitest";
import type {ContextSnapshot,Task} from "../../../../packages/contracts/src/models";
import {AppError} from "../../../../packages/contracts/src/error";
const state=vi.hoisted(()=>({changed:false,remoteCalls:0}));
vi.mock("../../../../packages/adapters/src/git/worktree-snapshot",()=>({captureWorktree:vi.fn(),assertWorktreeCurrent:async()=>{if(state.changed)throw new AppError("WORKTREE_CHANGED","code changed");}}));
vi.mock("../../../../packages/core/src/analysis/analysis-pipeline",()=>({AnalysisPipeline:class {async preanalyze(){return {};}}}));
import {Workbench} from "./workbench";
for(const change of ["code","logs"])it(`rejects ${change} changes while final remote validation is pending`,async()=>{
 state.changed=false;state.remoteCalls=0;let release!:()=>void;let entered!:()=>void;
 const gate=new Promise<void>(r=>release=r);const remote=new Promise<void>(r=>entered=r);
 const project={enabled:true,revision:1,aiProfileId:"ai"};
 const runtime=Object.assign(Object.create(Workbench.prototype),{store:{getProject:()=>project,issues:{get:()=>({})},materials:{get:()=>({id:"logs",manifestHash:state.changed&&change==="logs"?"new":"old",scope:{}}),latest:()=>({id:"logs"})}},issues:{validateFresh:async()=>{if(++state.remoteCalls===2){entered();await gate;}}},configurationHash:()=>"configuration",profile:()=>({}),transport:async()=>({}),bound:()=>({})}) as Workbench;
 const result=runtime.analyze({kind:"ANALYZE_BUG",projectId:"p",projectRevision:1,executionConfigurationHash:"configuration"} as Task,{configRevision:1,issueSnapshotId:"issue",repositories:change==="code"?[{kind:"worktree"}]:[],issueLogs:{id:"logs",manifestHash:"old"}} as ContextSnapshot,new AbortController().signal,()=>{});
 const outcome=result.then(()=>"accepted",error=>(error as AppError).code);await remote;state.changed=true;release();
 expect(await outcome).toBe(change==="code"?"WORKTREE_CHANGED":"ISSUE_LOG_CHANGED");
});

it("rejects worktree changes during requirement document verification",async()=>{
 state.changed=false;
 const runtime=Object.assign(Object.create(Workbench.prototype),{store:{getProject:()=>({})},captureDocuments:async()=>{state.changed=true;return {documents:[],sourceGaps:[]};}}) as Workbench;
 await expect(runtime.validateContext({projectId:"p",repositories:[{kind:"worktree"}],documents:[]} as unknown as ContextSnapshot,new AbortController().signal)).rejects.toMatchObject({code:"WORKTREE_CHANGED"});state.changed=false;
});
it("rejects changed requirement source content before saving a report",async()=>{
 state.changed=false;
 const runtime=Object.assign(Object.create(Workbench.prototype),{store:{getProject:()=>({})},captureDocuments:async()=>({documents:[{id:"new",bindingId:"resource",contentHash:"new"}],sourceGaps:[]})}) as Workbench;
 await expect(runtime.validateContext({projectId:"p",repositories:[],documents:[{id:"old",bindingId:"resource",contentHash:"old"}]} as unknown as ContextSnapshot,new AbortController().signal)).rejects.toMatchObject({code:"DOCUMENT_CHANGED"});
});
