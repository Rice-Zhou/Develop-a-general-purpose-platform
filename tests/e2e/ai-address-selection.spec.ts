import {test,expect,_electron as electron} from "@playwright/test";
import {createServer} from "node:http";
import {once} from "node:events";
import {mkdtemp,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
test("edits one AI connection without losing its secret/default and visibly selects HTTP after HTTPS fails",async()=>{
 const data=await mkdtemp(join(tmpdir(),"ai-protocol-e2e-"));let posts=0;let heads=0;
 const server=createServer(async(req,res)=>{if(req.method==="HEAD"){heads++;res.writeHead(405).end();return;}posts++;expect(req.url).toBe("/v1/edited/chat/completions");expect(req.headers.authorization).toBe("Bearer fixture-secret");let raw="";for await(const part of req)raw+=part;expect(JSON.parse(raw).messages).toHaveLength(2);res.setHeader("content-type","application/json");res.end(JSON.stringify({choices:[{message:{content:'{"probe":true}'}}]}));});
 server.listen(0,"127.0.0.1");await once(server,"listening");const address=`127.0.0.1:${(server.address() as {port:number}).port}/v1`;
 let app:Awaited<ReturnType<typeof electron.launch>>|undefined;
 try{
  app=await electron.launch({executablePath:process.env.PLATFORM_EXECUTABLE!,args:[],env:{...process.env,PLATFORM_E2E:"1",PLATFORM_DATA_DIR:data,HOME:data,USERPROFILE:data,APPDATA:data}});const page=await app.firstWindow();
  const id=await page.evaluate(async address=>{const r=await window.platform.saveAIProfile({kind:"api",name:"Existing AI",model:"fixture",baseUrl:`http://${address}`,outboundEnabled:true},"fixture-secret");if(!r.ok)throw new Error(r.error.message);return r.value.id;},address);
  await page.reload();await page.getByRole("button",{name:"设置",exact:true}).click();await page.getByRole("button",{name:"编辑连接",exact:true}).click();
  const editedAddress=`${address}/edited`;
  await page.getByLabel("模型服务地址",{exact:true}).fill(editedAddress);await expect(page.getByText(`https://${editedAddress}`,{exact:false})).toBeVisible();await page.getByRole("button",{name:"保存连接修改",exact:true}).click();
  const profiles=await page.evaluate(async()=>{const r=await window.platform.getAIProfiles();if(!r.ok)throw new Error(r.error.message);return r.value;});expect(profiles).toHaveLength(1);expect(profiles[0]).toMatchObject({id,baseUrl:editedAddress,hasCredential:true});
  await page.getByRole("button",{name:"测试连接",exact:true}).click();await expect(page.getByText(/HTTP（未加密）/).first()).toBeVisible();expect(posts).toBe(1);expect(heads).toBeGreaterThan(0);
  const selected=await page.evaluate(async()=>{const r=await window.platform.getDefaultAIProfile();return r.ok?r.value:null;});expect(selected).toBe(id);
  await page.screenshot({path:test.info().outputPath("ai-protocol-selection.png")});
 }finally{await app?.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(data,{recursive:true,force:true});}
});
