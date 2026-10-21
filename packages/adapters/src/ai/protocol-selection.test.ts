import { expect, it, vi } from "vitest";
import { SubscriptionTransport } from "./subscription";
import { ChatCompletionsTransport } from "./chat-completions";
import { createServer } from "node:http";
import { once } from "node:events";
it("selects the proxy before launching a subscription exactly once", async () => {
  const run = vi.fn(async () => JSON.stringify({result:'{"result":{}}'}));
  const resolve = vi.fn(async () => ({url:"http://127.0.0.1:7897",scheme:"http" as const,httpsFailure:"CONNECTION_FAILED"}));
  const diagnostics: string[] = [];
  await new SubscriptionTransport({kind:"claude",id:"id",name:"AI",model:"",executable:"D:/cli.exe",outboundEnabled:true,credentialRef:null,proxyUrl:"127.0.0.1:7897"},process.cwd(),run,undefined,resolve,detail=>diagnostics.push(detail)).complete([],[],new AbortController().signal);
  expect(run).toHaveBeenCalledOnce(); expect(resolve).toHaveBeenCalledOnce();
  expect((run.mock.calls[0] as unknown as [string,string[],{env:NodeJS.ProcessEnv}])[2].env.HTTPS_PROXY).toBe("http://127.0.0.1:7897");
  expect(diagnostics.join()).toContain("未加密");
});
it("never retries a POST after an authentication response or an ambiguous disconnect", async () => {
  for (const disconnect of [false,true]) {
    let posts=0;
    const server=createServer((req,res)=>{ posts++; if(disconnect)req.socket.destroy();else{res.writeHead(401);res.end("sensitive body");} });
    server.listen(0,"127.0.0.1"); await once(server,"listening");
    const url=`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`;
    const resolve=vi.fn(async()=>({url,scheme:"http" as const}));
    try {
      const model=new ChatCompletionsTransport({kind:"api",id:"id",name:"AI",model:"m",baseUrl:url,outboundEnabled:true,credentialRef:null},async()=>"secret",undefined,resolve);
      await expect(model.complete([],[],new AbortController().signal)).rejects.toMatchObject({code:disconnect?"MODEL_NETWORK_FAILED":"MODEL_AUTH_FAILED"});
      expect(posts).toBe(1); expect(resolve).toHaveBeenCalledOnce();
    } finally {server.closeAllConnections(); server.close(); await once(server,"close");}
  }
});
