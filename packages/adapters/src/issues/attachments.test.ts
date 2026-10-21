import { expect,it } from "vitest";
import { TrinityAdapter } from "./trinity";
import { JiraHttpAdapter } from "./jira-http";
import {downloadAttachmentFile} from "./attachment-download";
import {createServer} from "node:http";
import {once} from "node:events";
import {mkdtemp,readFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {createHash} from "node:crypto";
import type { IssueScope, RemoteIssue } from "../../../contracts/src/issues";
const scope:IssueScope={projectId:"code",enabled:true,binding:{id:"b",connectionId:"c",platform:"trinity",instanceUrl:"https://trinity.example/trinity",projectKey:"*",owner:"alice",scopeMode:"account",issueTypeIds:["BUG"]},connection:{id:"c",credentialRef:null,kind:"trinity",platform:"trinity",name:"T",baseUrl:"https://trinity.example/trinity",accountId:"alice",bypassProxy:true}};
const issue:RemoteIssue={remoteId:"internal",key:"BUG-1",workitemId:"work",instanceUrl:scope.connection.baseUrl,remoteProjectId:"P",ownerId:"alice",typeId:"BUG",title:"bug",description:"",status:"analysis",updatedAt:"now",versions:[],comments:[],attachments:[],warnings:[]};
it("discovers_then_downloads_verified_attachment and refuses redirects without exposing credentials",async()=>{
 const bytes=Buffer.from("actual log\nsecond line\n");let requests=0;
 const server=createServer((req,res)=>{requests++;expect(req.headers["x-token"]).toBe("fixture-token");if(req.url==="/redirect"){res.writeHead(302,{location:"http://evil.example/"});res.end();}else{res.write(bytes.subarray(0,5));res.end(bytes.subarray(5));}});
 server.listen(0,"127.0.0.1");await once(server,"listening");const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;const root=await mkdtemp(join(tmpdir(),"attachment-"));
 try{
  const destination=join(root,"download");const result=await downloadAttachmentFile(base+"/file",base,{"X-Token":"fixture-token"},destination,new AbortController().signal,"POST");
  expect(result).toEqual({size:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")});expect(await readFile(destination)).toEqual(bytes);
  await expect(downloadAttachmentFile(base+"/redirect",base,{"X-Token":"fixture-token"},join(root,"redirect"),new AbortController().signal)).rejects.toMatchObject({code:"ISSUE_DOWNLOAD_FAILED"});expect(requests).toBe(2);
 }finally{server.closeAllConnections();server.close();await once(server,"close");await rm(root,{recursive:true,force:true});}
});
it("discovers verified Trinity attachments using project and work item identity",async()=>{
  const request=async(url:string|URL|Request)=>{
    if(String(url).includes("userinfo"))return Response.json({code:200,data:{apiVersion:"v1",isGray:null}});
    const parsed=new URL(String(url));expect(parsed.pathname).toBe("/trinity/storage/attachments/findByTypeAndDataId");expect(parsed.searchParams.get("type")).toBe("quality-bug-file");expect(parsed.searchParams.get("dataId")).toBe("P_work");
    return Response.json({code:200,data:[{id:"file1",name:"logs.zip",fileSize:3,createTime:"today"}]});
  };
  expect(await new TrinityAdapter(async()=>"token",request as typeof fetch).listAttachments(scope,issue,new AbortController().signal)).toMatchObject([{id:"file1",name:"logs.zip"}]);
});
it("distinguishes verified empty attachments from invalid responses and missing identity",async()=>{
  const make=(data:unknown)=>new TrinityAdapter(async()=>"token",async(url)=>Response.json({code:200,data:String(url).includes("userinfo")?{apiVersion:"v1",isGray:null}:data}));
  expect(await make([]).listAttachments(scope,issue,new AbortController().signal)).toEqual([]);
  await expect(make({}).listAttachments(scope,issue,new AbortController().signal)).rejects.toThrow();
  await expect(make([]).listAttachments(scope,{...issue,workitemId:undefined},new AbortController().signal)).rejects.toMatchObject({code:"ISSUE_ATTACHMENTS_UNSUPPORTED"});
  await expect(make([]).listAttachments(scope,{...issue,ownerId:"bob"},new AbortController().signal)).rejects.toMatchObject({code:"ISSUE_OUT_OF_SCOPE"});
});
it("rejects Jira cross-host attachment addresses before downloading",async()=>{
  const jiraScope:IssueScope={...scope,binding:{...scope.binding,scopeMode:undefined,platform:"jira-dc",instanceUrl:"https://jira.example",projectKey:"A",owner:"alice",issueTypeIds:["1"]},connection:{id:"c",name:"J",kind:"jira-http",platform:"jira-dc",username:"alice",baseUrl:"https://jira.example",credentialRef:null,bypassProxy:true}};
  const jiraIssue={...issue,instanceUrl:"https://jira.example",remoteProjectId:"A",typeId:"1",key:"A-1"};
  const adapter=new JiraHttpAdapter(async()=>"secret",async()=>Response.json({key:"A-1",fields:{attachment:[{id:"1",filename:"log.txt",mimeType:"text/plain",size:3,content:"https://evil.example/log"}]}}));
  await expect(adapter.listAttachments(jiraScope,jiraIssue,new AbortController().signal)).rejects.toMatchObject({code:"ISSUE_ATTACHMENT_URL_INVALID"});
});
