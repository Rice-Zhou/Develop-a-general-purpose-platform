import { expect, it } from "vitest";
import { issueFixture } from "./issue-test-fixture";

function fixture() {
  const f=issueFixture();
  Object.assign(f.connections[1],{accountId:"alice"});
  Object.assign(f.project.issueBindings[1],{scopeMode:"account",projectKey:"*"});
  f.project.trinityProjects=[];
  return f;
}

it("discovers named Trinity projects from account issues without a code project and keeps distinct same-name IDs",async()=>{
  const f=fixture();
  f.rows.set("t",[
    {...f.remote(f.connections[1],1),remoteProjectId:"P1",remoteProjectName:"E0V_26款_SCDC_8295_国际左舵"},
    {...f.remote(f.connections[1],2),remoteProjectId:"P1",remoteProjectName:"E0V_26款_SCDC_8295_国际左舵"},
    {...f.remote(f.connections[1],3),remoteProjectId:"P2",remoteProjectName:"E0V_26款_SCDC_8295_国际左舵"},
  ]);
  f.project.deletedAt="deleted";
  expect(await f.service.trinityProjects("t",new AbortController().signal)).toEqual([
    {instanceUrl:"https://trinity.example/trinity",projectId:"P1",name:"E0V_26款_SCDC_8295_国际左舵"},
    {instanceUrl:"https://trinity.example/trinity",projectId:"P2",name:"E0V_26款_SCDC_8295_国际左舵"},
  ]);
  f.rows.get("t")![0].ownerId="other";
  await expect(f.service.trinityProjects("t",new AbortController().signal)).rejects.toMatchObject({code:"ISSUE_OUT_OF_SCOPE"});
});

it("verifies an unmatched issue before associating its real project and rejects transferred or stale issues",async()=>{
  const f=fixture();
  f.rows.set("t",[{...f.remote(f.connections[1],1),remoteProjectId:"P1",remoteProjectName:"车型项目"}]);
  const [issue]=await f.service.refresh("p","t",undefined,new AbortController().signal);
  expect(await f.service.mappingForIssue("p",issue.id,new AbortController().signal)).toEqual({instanceUrl:"https://trinity.example/trinity",projectId:"P1",name:"车型项目"});
  f.rows.get("t")![0].remoteProjectId="P2";
  await expect(f.service.mappingForIssue("p",issue.id,new AbortController().signal)).rejects.toMatchObject({code:"ISSUE_CHANGED"});
  f.rows.get("t")![0].ownerId="other";
  await expect(f.service.mappingForIssue("p",issue.id,new AbortController().signal)).rejects.toMatchObject({code:"ISSUE_OUT_OF_SCOPE"});
});

it("routes a multiply mapped issue only to an explicit matching target or the mapped current project",async()=>{
  const f=fixture();const b={...f.project,id:"b",name:"空调",trinityProjects:[{instanceUrl:f.connections[1].baseUrl,projectId:"A"}]};
  const c={...b,id:"c",name:"车身"};
  f.store.listProjects=()=>[f.project,b,c];
  f.store.getProject=(id?:string)=>id==="b"?b:id==="c"?c:f.project;
  const [issue]=await f.service.refresh("p","t",undefined,new AbortController().signal);
  f.store.issues.get=(_p,id)=>{if(id===issue.id)return issue;throw new Error("missing snapshot");};
  expect(f.service.analysisTarget("p",issue).analysisProjects).toEqual([{id:"b",name:"空调"},{id:"c",name:"车身"}]);
  expect(()=>f.service.analysisInput("p",issue.id)).toThrow(/多个代码项目/);
  expect(f.service.analysisInput("p",issue.id,"c").projectId).toBe("c");
  expect(()=>f.service.analysisInput("p",issue.id,"p")).toThrow();
  expect(f.service.analysisTarget("b",issue).analysisProjectId).toBe("b");
});

it("rejects project discovery when the Trinity account changes while reading",async()=>{
 const f=fixture();const pending=f.service.trinityProjects("t",new AbortController().signal);
 f.store.setSetting("issue-connections",[f.connections[0],{...f.connections[1],accountId:"other"}]);
 await expect(pending).rejects.toMatchObject({code:"PROJECT_CHANGED"});
});
