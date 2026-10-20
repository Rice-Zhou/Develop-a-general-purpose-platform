import { expect, it } from "vitest";
import { FeishuIssueNotifier } from "./issue-notifier";
import type { IssueNotification } from "../../../contracts/src/issue-monitor";
import { ProcessExitError } from "../process/run-process";

it("sends directly to the saved recipient with bot identity and the persisted idempotency key", async () => {
  const calls: string[][] = [];
  let openId = "ou_self";
  const notifier = new FeishuIssueNotifier(() => ({ larkExecutable: "D:/lark.exe", identity: "user" }), async (_exe, args) => {
    calls.push(args);
    return JSON.stringify(args[0] === "api" ? { code: 0, data: { open_id: openId, name: "Local User" } } : { ok: true, data: { message_id: "om_sent" } });
  });
  const signal = new AbortController().signal;
  const recipient = await notifier.self(signal);
  const event: IssueNotification = { id: "11111111-1111-4111-8111-111111111111", projectId: "p", bindingId: "b", scopeHash: "hash", remoteId: "1", key: "A-1", text: "有新的 BUG：A-1" };
  await notifier.send(event, recipient, signal, () => {});
  expect(calls[0]).toEqual(["api", "GET", "/open-apis/authen/v1/user_info", "--as", "user", "--format", "json"]);
  expect(calls[1]).toEqual(["im", "+messages-send", "--as", "bot", "--user-id", "ou_self", "--text", event.text, "--idempotency-key", event.id, "--format", "json"]);
  openId = "ou_another";
  await notifier.send(event, recipient, signal, () => {});
  expect(calls.filter(c => c[0] === "api")).toHaveLength(1);
  expect(calls.at(-1)).toContain("ou_self");
});

it("searches names using the verified CLI shortcut and preserves distinct same-name accounts", async () => {
  const notifier = new FeishuIssueNotifier(() => ({larkExecutable:"D:/lark.exe",identity:"user"}), async (_exe,args) => {
    expect(args).toEqual(["contact","+search-user","--query","周贺棋","--as","user","--page-size","30","--format","json"]);
    return JSON.stringify({ok:true,data:{users:[{open_id:"ou_one",localized_name:"周贺棋",department:"部门一"},{open_id:"ou_two",localized_name:"周贺棋",department:"部门二"}],has_more:true}});
  });
  expect(await notifier.search("周贺棋",new AbortController().signal)).toEqual({users:[{openId:"ou_one",name:"周贺棋",department:"部门一"},{openId:"ou_two",name:"周贺棋",department:"部门二"}],hasMore:true});
});

it("reports missing user authorization with a fixed login instruction instead of CLI JSON", async () => {
  const diagnostic=JSON.stringify({ok:false,identity:"user",error:{type:"authentication",subtype:"token_missing",message:"private diagnostic",user_open_id:"ou_private"}});
  const notifier=new FeishuIssueNotifier(()=>({larkExecutable:"D:/lark.exe",identity:"user"}),async()=>{throw new ProcessExitError(3,diagnostic);});
  await expect(notifier.self(new AbortController().signal)).rejects.toMatchObject({code:"FEISHU_AUTH_REQUIRED",message:expect.stringContaining("lark-cli auth login")});
  await expect(notifier.self(new AbortController().signal)).rejects.not.toMatchObject({message:expect.stringContaining("ou_private")});
});

it("keeps bot authorization failures distinct and never queries user identity during direct sends",async()=>{
  const calls:string[][]=[];
  const notifier=new FeishuIssueNotifier(()=>({larkExecutable:"D:/lark.exe",identity:"user"}),async(_exe,args)=>{calls.push(args);return JSON.stringify({ok:false,identity:"bot",error:{type:"authentication",subtype:"credentials_missing"}});});
  await expect(notifier.send({id:"11111111-1111-4111-8111-111111111111",text:"new bug"} as IssueNotification,{openId:"ou_target",name:"Target"},new AbortController().signal,()=>{})).rejects.toMatchObject({code:"FEISHU_BOT_AUTH_REQUIRED"});
  expect(calls).toHaveLength(1);expect(calls[0].slice(0,2)).toEqual(["im","+messages-send"]);
});
it("does not acknowledge success without a message receipt", async () => {
  const notifier = new FeishuIssueNotifier(() => ({ larkExecutable: "D:/lark.exe", identity: "user" }), async (_e, args) => JSON.stringify(args[0] === "api" ? { code: 0, data: { open_id: "ou_self", name: "Self" } } : { ok: true, data: {} }));
  await expect(notifier.send({ id: "11111111-1111-4111-8111-111111111111", text: "new bug" } as IssueNotification, { openId: "ou_self", name: "Self" }, new AbortController().signal, () => {})).rejects.toMatchObject({ code: "FEISHU_NOTIFICATION_FAILED" });
});
