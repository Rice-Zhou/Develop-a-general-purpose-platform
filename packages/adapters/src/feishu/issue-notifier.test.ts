import { expect, it } from "vitest";
import { FeishuIssueNotifier } from "./issue-notifier";
import type { IssueNotification } from "../../../contracts/src/issue-monitor";

it("uses the current CLI user, bot DM and persisted idempotency key; rejects a changed user before sending", async () => {
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
  expect(calls[2]).toEqual(["im", "+messages-send", "--as", "bot", "--user-id", "ou_self", "--text", event.text, "--idempotency-key", event.id, "--format", "json"]);
  openId = "ou_another";
  await expect(notifier.send(event, recipient, signal, () => {})).rejects.toMatchObject({ code: "FEISHU_IDENTITY_CHANGED" });
  expect(calls.filter(c => c[0] === "im")).toHaveLength(1);
});
it("does not acknowledge success without a message receipt", async () => {
  const notifier = new FeishuIssueNotifier(() => ({ larkExecutable: "D:/lark.exe", identity: "user" }), async (_e, args) => JSON.stringify(args[0] === "api" ? { code: 0, data: { open_id: "ou_self", name: "Self" } } : { ok: true, data: {} }));
  await expect(notifier.send({ id: "11111111-1111-4111-8111-111111111111", text: "new bug" } as IssueNotification, { openId: "ou_self", name: "Self" }, new AbortController().signal, () => {})).rejects.toMatchObject({ code: "FEISHU_NOTIFICATION_FAILED" });
});
