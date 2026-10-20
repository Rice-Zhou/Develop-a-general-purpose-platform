import { expect, it } from "vitest";
import { IssueMonitor } from "./issue-monitor";
import { issueFixture } from "./issue-test-fixture";
import type { IssueNotifier, NotificationRecipient } from "../../../contracts/src/issue-monitor";

it("saves an explicitly selected search result and sends after restart without querying the current CLI user", async () => {
  const f=issueFixture(); const sent:string[]=[]; let selfReads=0;
  const users=[{openId:"ou_one",name:"同名用户",department:"部门一"},{openId:"ou_two",name:"同名用户",department:"部门二"}];
  const notifier:IssueNotifier={search:async()=>({users,hasMore:false}),self:async()=>{selfReads++;throw new Error("user token missing");},send:async(_event,recipient,_signal,authorize)=>{authorize();sent.push(recipient.openId);}};
  let monitor=new IssueMonitor(f.store,f.service,notifier);
  const found=await monitor.searchRecipients("同名用户");found.users[1].name="forged name";
  expect(()=>monitor.selectRecipient("ou_unknown")).toThrow();
  monitor.selectRecipient("ou_two");
  expect(monitor.status().recipient).toEqual(users[1]);
  monitor=new IssueMonitor(f.store,f.service,notifier);
  await monitor.refreshProject("p");f.rows.get("j")!.push(f.remote(f.connections[0],2));await monitor.refreshProject("p");
  expect(sent).toEqual(["ou_two"]);expect(selfReads).toBe(0);
});

it("does not overwrite a selected recipient when a previous current-user lookup completes later",async()=>{
  const f=issueFixture();let release!:(recipient:NotificationRecipient)=>void;
  const monitor=new IssueMonitor(f.store,f.service,{search:async()=>({users:[{openId:"ou_selected",name:"Selected"}],hasMore:false}),self:()=>new Promise(resolve=>{release=resolve;}),send:async()=>{}});
  const checking=monitor.checkNotification();await monitor.searchRecipients("Selected");monitor.selectRecipient("ou_selected");
  release({openId:"ou_old",name:"Old"});await expect(checking).rejects.toMatchObject({code:"FEISHU_RECIPIENT_CHANGED"});
  expect(monitor.status().recipient?.openId).toBe("ou_selected");
});

it("keeps pending notifications and rejects an in-flight stale recipient before retrying to the newly saved account",async()=>{
  const f=issueFixture();let release!:()=>void;let started!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});const sending=new Promise<void>(resolve=>{started=resolve;});
  const attempts:{id:string;to:string}[]=[];const sent:string[]=[];
  const monitor=new IssueMonitor(f.store,f.service,{search:async()=>({users:[{openId:"ou_one",name:"One"},{openId:"ou_two",name:"Two"}],hasMore:false}),self:async()=>{throw new Error("must not query current user");},send:async(event,recipient,_signal,authorize)=>{attempts.push({id:event.id,to:recipient.openId});started();await gate;authorize();sent.push(recipient.openId);}});
  await monitor.searchRecipients("name");monitor.selectRecipient("ou_one");await monitor.refreshProject("p");
  f.rows.get("j")!.push(f.remote(f.connections[0],2));const refreshing=monitor.refreshProject("p");await sending;
  monitor.selectRecipient("ou_two");release();await refreshing;
  expect(sent).toEqual([]);expect(monitor.status().pendingCount).toBe(1);
  await monitor.refreshProject("p");expect(sent).toEqual(["ou_two"]);expect(monitor.status().pendingCount).toBe(0);
  expect(attempts[1].id).not.toBe(attempts[0].id);
});
