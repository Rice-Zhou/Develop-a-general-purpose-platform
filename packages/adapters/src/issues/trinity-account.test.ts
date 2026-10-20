import { expect,it } from "vitest";
import { TrinityAdapter } from "./trinity";
import { loginTrinity,readTrinityIdentity } from "./login";
import type { IssueScope } from "../../../contracts/src/issues";
const scope:IssueScope={projectId:"code",enabled:true,binding:{id:"b",platform:"trinity",instanceUrl:"https://trinity.example/trinity",connectionId:"c",owner:"uid1",projectKey:"*",scopeMode:"account",issueTypeIds:["BUG"]},connection:{id:"c",kind:"trinity",platform:"trinity",name:"Trinity",baseUrl:"https://trinity.example/trinity",username:"login-name",accountId:"uid1",credentialRef:null,bypassProxy:true}};
it("lists only the authenticated account across remote projects and checks each owner",async()=>{
 let owner="uid1";let repeated=false;
 const adapter=new TrinityAdapter(async()=>"token",(async(url,init)=>{
  const path=String(url);
  if(path.endsWith("userinfo"))return Response.json({code:200,data:{apiVersion:"v7",isGray:false}});
  if(path.includes("getBugsByMultiProjects")){
   const body=JSON.parse(init!.body as string);expect(body).toMatchObject({allProjects:true,mode:"assignToMe",userId:"uid1",projectIds:[]});expect(body.projectId).toBeUndefined();
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
