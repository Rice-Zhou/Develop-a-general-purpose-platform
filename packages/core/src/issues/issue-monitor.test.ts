import { expect, it } from "vitest";
import { issueFixture } from "./issue-test-fixture";
import { IssueMonitor } from "./issue-monitor";

it("baselines all sources, notifies only new arrivals, and persists delivery across restart and source failure", async () => {
  const f = issueFixture();
  const sent: string[] = [];
  let failSend = false;
  const notifier = {
    self: async () => ({ openId: "ou_self", name: "Local User" }),
    send: async (event: { id: string }) => { if (failSend) throw new Error("notification offline"); sent.push(event.id); },
  };
  const create = () => new IssueMonitor(f.store, f.service, notifier);
  let monitor = create();
  await monitor.refreshProject("p");
  expect(sent).toHaveLength(0);
  f.rows.get("t")!.push(f.remote(f.connections[1], 2));
  f.failures.add("j");
  failSend = true;
  const partial = await monitor.refreshProject("p");
  expect(partial.sources.find(s => s.bindingId === "j")?.status).toBe("failed");
  expect(partial.issues).toHaveLength(3);
  expect(monitor.status().pendingCount).toBe(1);
  expect(monitor.status().notificationError?.message).toContain("notification offline");
  monitor = create();
  failSend = false;
  await monitor.refreshProject("p");
  await monitor.refreshProject("p");
  expect(sent).toHaveLength(1);
  expect(monitor.status().pendingCount).toBe(0);
  f.rows.get("j")!.push(f.remote(f.connections[0], 2));
  f.failures.delete("j");
  await monitor.refreshProject("p");
  expect(sent).toHaveLength(2);
  f.project.enabled = false;
  f.rows.get("t")!.push(f.remote(f.connections[1], 3));
  await monitor.tick();
  expect(sent).toHaveLength(2);
});

it("polls at the configured interval and does not notify first-baseline or unchanged observations", async () => {
  const f = issueFixture();
  let now = 0;
  const sent: string[] = [];
  const monitor = new IssueMonitor(f.store, f.service, {
    self: async () => ({ openId: "ou_self", name: "Self" }),
    send: async event => { sent.push(event.key); },
  }, () => now);
  await monitor.tick();
  expect(sent).toEqual([]);
  f.rows.get("j")!.push(f.remote(f.connections[0], 2));
  now = 4 * 60000;
  await monitor.tick();
  expect(sent).toEqual([]);
  now = 5 * 60000;
  await monitor.tick();
  expect(sent).toEqual(["A-2"]);
  now = 10 * 60000;
  await monitor.tick();
  expect(sent).toEqual(["A-2"]);
});

it("coalesces concurrent manual and timer refresh and drops pending messages for a changed or deleted scope", async () => {
  const f = issueFixture();
  let failSend = true;
  const sent: string[] = [];
  const monitor = new IssueMonitor(f.store, f.service, {
    self: async () => ({ openId: "ou_self", name: "Local User" }),
    send: async (event) => { if (failSend) throw new Error("offline"); sent.push(event.id); },
  });
  await monitor.refreshProject("p");
  f.rows.get("t")!.push(f.remote(f.connections[1], 2));
  await Promise.all([monitor.refreshProject("p"), monitor.refreshProject("p")]);
  expect(monitor.status().pendingCount).toBe(1);
  f.project.deletedAt = "now";
  failSend = false;
  await monitor.tick();
  expect(sent).toHaveLength(0);
  expect(monitor.status().pendingCount).toBe(0);
});
