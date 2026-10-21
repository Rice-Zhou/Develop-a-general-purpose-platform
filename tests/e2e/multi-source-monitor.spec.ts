import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { gitFixture } from "../../packages/testkit/src/git-fixture";

test("aggregates both platforms, isolates failures and periodically notifies the local CLI user only about new bugs", async () => {
  test.setTimeout(150000);
  const data = await mkdtemp(join(tmpdir(), "multi-source-monitor-"));
  const fixture = await gitFixture();
  let trinityFailed = false;
  let trinityCount = 1;
  let jiraCount = 1;
  const requests: string[] = [];
  const server = createServer(async (req, res) => {
    if(req.method === "HEAD"){res.writeHead(405).end();return;}

    res.setHeader("content-type", "application/json");
    const url = new URL(req.url!, "http://localhost");
    requests.push(url.pathname);
    const reply = (value: unknown) => res.end(JSON.stringify(value));
    if (url.pathname === "/rest/api/2/myself") return reply({ name: "alice" });
    if (url.pathname === "/rest/api/2/project") return reply([{ key: "A", name: "Project A" }]);
    if (url.pathname === "/rest/api/2/issuetype") return reply([{ id: "1", name: "Bug" }]);
    if (url.pathname === "/trinity/sys/user/userinfo") return reply({ code: 200, data: { uid:"alice", apiVersion: "Trinity V7.5.0", isGray: false } });
    if (url.pathname === "/rest/api/2/search") {
      const issues = Array.from({ length: jiraCount }, (_, i) => ({ id: String(i + 1), key: `A-${i + 1}`, self: `${base}/rest/api/2/issue/${i + 1}`, fields: { project: { key: "A" }, assignee: { name: "alice" }, issuetype: { id: "1" }, summary: "Jira bug", description: "fixture", status: { name: "分析中" }, updated: "now", versions: [], comment: { total: 0, comments: [] }, attachment: [] } }));
      return reply({ startAt: 0, total: issues.length, issues });
    }
    if (url.pathname === "/trinity/quality/bugRedux/getBugsByMultiProjects") {
      expect(req.headers.apiversion).toBe("Trinity V7.5.0");
      let text = "";
      for await (const part of req) text += part;
      const body = JSON.parse(text);
      expect(body.projectIds).toEqual([]);
      expect(body.bugReduxCustomConditionsQueryBO).toMatchObject({logicalOperator:"and",conditions:[{field:"assigneeId",operation:"EQ",type:"SINGLEUSER",values:["alice"]}]});
      if (trinityFailed) { res.writeHead(503).end("{}"); return; }
      return reply({ code:200, data: { total: trinityCount, records: Array.from({ length: trinityCount }, (_, i) => ({ bugId: `T-${i + 1}` })) } });
    }
    if (url.pathname === "/trinity/quality/bugRedux/getByBugId") {
      const key = url.searchParams.get("bugId")!;
      return reply({ code: 200, data: { id: key, workitemId: `W-${key}`, bugId: key, projectId: "T", assigneeId: "alice", title: "Trinity bug", description: "fixture", status: "assigned", updateTime: "now" } });
    }
    res.writeHead(404).end("{}");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const exe = join(data, "lark-fixture.exe");
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    execFileSync(join(process.env.SystemRoot ?? "C:/Windows", "Microsoft.NET/Framework64/v4.0.30319/csc.exe"), ["/nologo", `/out:${exe}`, resolve("packages/testkit/fixtures/issues/LarkNotificationFixture.cs")], { windowsHide: true, stdio: "pipe" });
    app = await electron.launch({ executablePath: process.env.PLATFORM_EXECUTABLE!, args: [], env: { ...process.env, HOME: data, USERPROFILE: data, APPDATA: data, PLATFORM_DATA_DIR: join(data, "app") } });
    const page = await app.firstWindow();
    await page.evaluate(async ({ base, repo, exe }) => {
      function take<T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T { if (!result.ok) throw new Error(result.error.message); return result.value; }
      const jira = take(await window.platform.saveIssueConnection({ kind: "jira-http", platform: "jira-dc", jiraProject:{key:"A",name:"Project A",owner:"alice",issueTypeIds:["1"]}, name: "Jira", baseUrl: base, username: "alice", bypassProxy: true }, "fixture-password"));
      const trinity = take(await window.platform.saveIssueConnection({ kind: "trinity", platform: "trinity", name: "Trinity", baseUrl: base + "/trinity", bypassProxy: true }, "fixture-token"));
      take(await window.platform.saveCliConfiguration({ larkExecutable: exe, identity: "user" }));
      take(await window.platform.saveProject({ name: "多来源项目", enabled: true, repositories: [{ path: repo, branch: "main", remoteName: "origin", role: "main" }], documents: [], aiProfileId: null, issueBindings: [{ id: "jira", platform: "jira-dc", instanceUrl: base, projectKey: "A", owner: "alice", connectionId: jira.id, issueTypeIds: ["1"] }, { id: "trinity", platform: "trinity", instanceUrl: base + "/trinity", projectKey: "T", owner: "alice", connectionId: trinity.id, issueTypeIds: ["BUG"] }] }));
    }, { base, repo: fixture.analysis, exe });
    await page.getByRole("button", { name: "BUG 工作台", exact: true }).click();
    const refresh = page.getByRole("button", { name: "刷新问题单", exact: true });
    await refresh.click();
    await expect(page.getByRole("link", { name: "A-1", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "T-1", exact: true })).toHaveAttribute("href", new RegExp("/#/bug/newBugDetail\\?"));
    expect(await readFile(join(data, "notifications.txt"), "utf8").catch(e => { if (e.code === "ENOENT") return ""; throw e; })).toBe("");
    await page.getByText(/定时查询与飞书提醒 ·/).click();
    await page.getByLabel("查询间隔（分钟）").fill("1");
    await page.getByRole("button", { name: "保存监控设置", exact: true }).click();
    await page.getByRole("button", { name: "使用当前 CLI 用户", exact: true }).click();
    await expect(page.getByText(/通知接收人：Local User/)).toBeVisible();
    jiraCount = 2;
    trinityFailed = true;
    await refresh.click();
    await expect(page.getByRole("link", { name: "A-2", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "T-1", exact: true })).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("503");
    const notifications = () => readFile(join(data, "notifications.txt"), "utf8");
    await expect.poll(notifications).toContain("A-2");
    trinityFailed = false;
    trinityCount = 2;
    // Wait for the real one-minute schedule without clicking refresh again.
    await expect(page.getByRole("link", { name: "T-2", exact: true })).toBeVisible({ timeout: 95000 });
    await expect.poll(notifications, { timeout: 15000 }).toContain("T-2");
    await refresh.click();
    await expect(refresh).toBeEnabled({ timeout: 15000 });
    const sent = (await notifications()).trim().split("\n");
    expect(sent).toHaveLength(2);
    expect(sent.every(line => line.includes("--user-id|ou_fixture") && line.includes("--as|bot") && line.includes("--idempotency-key|"))).toBe(true);
    expect(requests.some(path => path.includes("worklist"))).toBe(false);
    await page.screenshot({ path: "test-results/multi-source-monitor.png" });
  } finally {
    await app?.close(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await fixture.dispose(); await rm(data, { recursive: true, force: true });
  }
});
