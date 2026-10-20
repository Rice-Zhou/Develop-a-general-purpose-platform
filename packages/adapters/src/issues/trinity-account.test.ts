import { expect,it } from "vitest";
import { TrinityAdapter } from "./trinity";
import { loginTrinity,readTrinityIdentity } from "./login";
import type { IssueScope } from "../../../contracts/src/issues";
const scope:IssueScope={projectId:"code",enabled:true,binding:{id:"b",platform:"trinity",instanceUrl:"https://trinity.example/trinity",connectionId:"c",owner:"uid1",projectKey:"*",scopeMode:"account",issueTypeIds:["BUG"]},connection:{id:"c",kind:"trinity",platform:"trinity",name:"Trinity",baseUrl:"https://trinity.example/trinity",username:"login-name",accountId:"uid1",credentialRef:null,bypassProxy:true}};
it.each(["server-session-token", "Bearer server-session-token"])("preserves the server-issued X-Token for identity and BUG requests: %s", async token => {
 const request = (async (url, init) => {
  if (new Headers(init?.headers).get("X-Token") !== token) return Response.json({code:5002,data:null,success:false,msg:"private response"});
  if (String(url).endsWith("userinfo")) return Response.json({code:200,data:{uid:"uid1",apiVersion:"v7",isGray:false}});
  return Response.json({code:200,data:{id:"1",bugId:"BUG-1",projectId:"P",assigneeId:"uid1",title:"Bug",description:"",status:"Open",updateTime:"now"}});
 }) as typeof fetch;
 expect(await readTrinityIdentity(scope.connection.baseUrl,token,request)).toEqual({accountId:"uid1"});
 expect((await new TrinityAdapter(async()=>token,request).get(scope,"BUG-1",new AbortController().signal)).key).toBe("BUG-1");
});
it("distinguishes rejected sessions and invalid protocol fields from a missing UID without exposing response content", async () => {
 for (const [raw,code] of [
  [{code:5002,data:null,msg:"private-token"},"ISSUE_LOGIN_FAILED"],
  [{code:200,data:{uid:"uid1"}},"TRINITY_PROTOCOL_INVALID"],
  [{code:200,data:{uid:"  ",apiVersion:"v7",isGray:false}},"TRINITY_IDENTITY_REQUIRED"],
 ] as const) {
  await expect(readTrinityIdentity(scope.connection.baseUrl,"token",(async()=>Response.json(raw)) as typeof fetch)).rejects.toMatchObject({code,message:expect.not.stringContaining("private-token")});
 }
 await expect(new TrinityAdapter(async()=>"token",(async()=>Response.json({code:5002,data:null,msg:"private-token"})) as typeof fetch).get(scope,"BUG-1",new AbortController().signal)).rejects.toMatchObject({code:"ISSUE_LOGIN_FAILED",message:expect.not.stringContaining("private-token")});
});
it("lists only the authenticated account across remote projects and checks each owner",async()=>{
 let owner="uid1";let repeated=false;
 const adapter=new TrinityAdapter(async()=>"token",(async(url,init)=>{
  const path=String(url);
  if(path.endsWith("userinfo"))return Response.json({code:200,data:{apiVersion:"v7",isGray:false}});
  if(path.includes("getBugsByMultiProjects")){
   const body=JSON.parse(init!.body as string);expect(body).toMatchObject({allProjects:true,projectIds:[],bugReduxCustomConditionsQueryBO:{logicalOperator:"and",conditions:[{field:"assigneeId",operation:"EQ",values:["uid1"],type:"SINGLEUSER",fieldType:"STRING"}]}});expect(body.projectId).toBeUndefined();
   return Response.json({code:200,data:{page:{total:repeated?2:1,records:[{bugId:"B-1"}]}}});
  }
  return Response.json({code:200,data:{id:"1",bugId:"B-1",projectId:"outside-code-project",assigneeId:owner,title:"Bug",description:"detail",status:"Open",updateTime:"now"}});
 }) as typeof fetch);
 expect((await adapter.list(scope,new AbortController().signal))[0].remoteProjectId).toBe("outside-code-project");
 owner="other";await expect(adapter.list(scope,new AbortController().signal)).rejects.toMatchObject({code:"ISSUE_OUT_OF_SCOPE"});
 owner="uid1";repeated=true;await expect(adapter.list(scope,new AbortController().signal)).rejects.toMatchObject({code:"ISSUE_PAGINATION_INVALID"});
});
it("normalizes the Trinity web root and verifies the returned account UID",async()=>{
 const urls:string[]=[];
 const request=(async(url,init)=>{
  const path=String(url);urls.push(path);
  if(path.endsWith("userinfo"))return Response.json({code:200,data:{uid:123,apiVersion:"v7",isGray:false}});
  if(path.endsWith("/ldap")){expect(init!.body).not.toContain("password");return Response.json({code:200,data:{token:"token"}});}
  if(path.endsWith("app.js"))return new Response('a=r.enc.Utf8.parse("0123456789abcdef"),b=r.enc.Utf8.parse("fedcba9876543210");function x(t){return r.AES.encrypt(t,a)}');
  return new Response('<script src="static/js/app.js"></script>');
 }) as typeof fetch;
 const token=await loginTrinity("https://trinity.example/","login-name","password",request);
 expect(await readTrinityIdentity("https://trinity.example/",token,request)).toEqual({accountId:"123"});
 expect(urls).toContain("https://trinity.example/trinity/security/login/ldap");expect(urls).toContain("https://trinity.example/trinity/sys/user/userinfo");
 await expect(readTrinityIdentity(scope.connection.baseUrl,"token",(async()=>Response.json({code:200,data:{apiVersion:"v7",isGray:false}})) as typeof fetch)).rejects.toMatchObject({code:"TRINITY_IDENTITY_REQUIRED"});
});
