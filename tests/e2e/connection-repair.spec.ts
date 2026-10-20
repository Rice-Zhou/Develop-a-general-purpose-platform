import { test, expect, _electron as electron } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DataStore } from "../../packages/storage/src/database";
import { gitFixture } from "../../packages/testkit/src/git-fixture";

test("repairs a missing Jira binding explicitly and renews the same connection without orphaning projects", async () => {
  const data = await mkdtemp(join(tmpdir(), "connection-repair-"));
  const fixture = await gitFixture();
  const server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    const path = new URL(req.url!, "http://localhost").pathname;
    if (path.endsWith("/myself")) res.end(JSON.stringify({ name: "alice" }));
    else if (path.endsWith("/project")) res.end(JSON.stringify([{ key: "A", name: "项目甲" }]));
    else if (path.endsWith("/issuetype")) res.end(JSON.stringify([{ id: "1", name: "Bug" }]));
    else if (path.endsWith("/search")) res.end(JSON.stringify({ startAt: 0, total: 1, issues: [{ id: "1", key: "A-1", self: base + "/rest/api/2/issue/A-1", fields: { project: { key: "A" }, assignee: { name: "alice" }, issuetype: { id: "1" }, summary: "Recovered bug", description: "fixture", status: { name: "分析中" }, updated: "2026-10-19", versions: [], comment: { total: 0, comments: [] }, attachment: [] } }] }));
    else res.writeHead(404).end("{}");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const projectId = randomUUID(), connectionId = randomUUID(), missingId = randomUUID();
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    // Seed the dangling reference left by older releases, in an isolated database only.
    const store = await DataStore.open(join(data, "platform.db"));
    try {
      store.setSetting("issue-connections", [{ id: connectionId, credentialRef: null, kind: "jira-http", platform: "jira-dc", name: "可用连接", baseUrl: base, username: "alice", bypassProxy: true }]);
      store.saveProject({ id: projectId, revision: 1, name: "待修复项目", enabled: true, repositories: [{ id: randomUUID(), canonicalPath: fixture.analysis, branch: "main", remoteName: "origin", role: "main", remoteUrlFingerprint: null }], documents: [], aiProfileId: null, updatedAt: new Date().toISOString(), issueBindings: [{ id: randomUUID(), connectionId: missingId, platform: "jira-dc", instanceUrl: base, projectKey: "A", owner: "alice", issueTypeIds: ["1"] }] });
    } finally { store.close(); }
    app = await electron.launch({ executablePath: process.env.PLATFORM_EXECUTABLE!, args: [], env: { ...process.env, PLATFORM_DATA_DIR: data, PLATFORM_E2E: "1", HOME: data, USERPROFILE: data, APPDATA: data } });
    const page = await app.firstWindow();
    const connectionsPanel = page.locator("section.work-panel").filter({ has: page.getByRole("heading", { name: "Jira 与 Trinity 登录", exact: true }) });
    // The saved login can be renewed, rather than deleting and recreating its ID.
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByRole("button", { name: "编辑 / 重新登录", exact: true }).click();
    await expect(connectionsPanel.getByLabel("连接名称", { exact: true })).toHaveValue("可用连接");
    await page.getByLabel("登录密码", { exact: true }).fill("fixture-password");
    await page.getByRole("button", {name:"登录并读取 Jira 项目",exact:true}).click();
    const jp=page.getByRole("combobox",{name:"Jira 项目",exact:true});await expect(jp).toBeEnabled();await jp.fill("甲");await page.getByRole("option",{name:"项目甲（A）",exact:true}).click();
    await page.getByRole("button", { name: "保存连接修改", exact: true }).click();
    await expect(page.getByText("Jira 连接及对应项目已保存，可直接关联代码项目。", { exact: true })).toBeVisible();
    const ids = await page.evaluate(async () => { const r = await window.platform.getIssueConnections(); if (!r.ok) throw new Error(r.error.message); return r.value.map(c => c.id); });
    expect(ids).toEqual([connectionId]);
    await page.getByRole("button", { name: "BUG 工作台", exact: true }).click();
    await expect(page.getByText(/项目关联的 BUG 来源连接已不存在/)).toBeVisible();
    await page.getByRole("button", { name: "重新关联来源", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "管理项目关联", exact: true });
    await expect(editor.getByText(/原 Jira 连接已不存在/)).toBeVisible();
    await expect(editor.getByLabel("Jira 项目连接")).toHaveValue(missingId);
    await editor.getByLabel("Jira 项目连接").selectOption(connectionId);
    await expect(editor.getByRole("combobox",{name:"Jira 项目",exact:true})).toHaveCount(0);
    await editor.getByRole("button", { name: "保存关联", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await page.getByRole("button", { name: "刷新问题单", exact: true }).click();
    await expect(page.getByRole("link", { name: "A-1", exact: true })).toHaveAttribute("href", base + "/browse/A-1");
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByRole("button", { name: "编辑 / 重新登录", exact: true }).click();
    await expect(page.getByLabel("登录密码", { exact: true })).toHaveValue("");
    await connectionsPanel.getByLabel("连接名称", { exact: true }).fill("重命名连接");
    await page.getByLabel("登录密码", { exact: true }).fill("fixture-password");
    await page.getByRole("button",{name:"登录并读取 Jira 项目",exact:true}).click();
    await expect(page.getByRole("combobox",{name:"Jira 项目",exact:true})).toBeEnabled();
    await page.getByRole("button", { name: "保存连接修改", exact: true }).click();
    await expect(page.getByText("Jira 连接及对应项目已保存，可直接关联代码项目。", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "BUG 工作台", exact: true }).click();
    await page.getByRole("button", { name: "刷新问题单", exact: true }).click();
    await expect(page.getByRole("link", { name: "A-1", exact: true })).toBeVisible();
    const snapshotIds = await page.evaluate(async (projectId) => {
      const r = await window.platform.getBugWorkspace(projectId);
      if (!r.ok) throw new Error(r.error.message);
      return r.value.issues.map(i => i.id);
    }, projectId);
    expect(snapshotIds.length).toBeGreaterThan(0);
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByRole("button", { name: "删除平台连接", exact: true }).click();
    await expect(page.getByText("平台连接已删除，所有代码项目的对应关联已解除；代码项目和历史材料已保留。", {exact:true})).toBeVisible();
    await expect(page.getByRole("button", { name: "删除平台连接", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "BUG 工作台", exact: true }).click();
    await expect(page.getByRole("link", { name: "A-1", exact: true })).toHaveCount(0);
    await expect(page.getByText(/项目关联的 BUG 来源连接已不存在/)).toHaveCount(0);
    await page.bringToFront();
    await page.screenshot({ path: test.info().outputPath("repaired-workspace.png") });
    await app.close(); app = undefined;
    const verified = await DataStore.open(join(data, "platform.db"));
    try {
      expect(verified.getProject(projectId).issueBindings).toEqual([]);
      expect(verified.getProject(projectId).repositories[0].canonicalPath).toBe(fixture.analysis);
      expect(verified.issues.get(projectId,snapshotIds[0]).key).toBe("A-1");
    } finally { verified.close(); }
  } finally {
    await app?.close();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await fixture.dispose();
    await rm(data, { recursive: true, force: true });
  }
});
