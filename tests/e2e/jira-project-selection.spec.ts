import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gitFixture } from "../../packages/testkit/src/git-fixture";

for (const mode of ["account", "cli"] as const) test(`project setup via ${mode} lists Jira projects and binds exactly one with login owner`, async () => {
  test.skip(mode === "cli" && !process.env.PLATFORM_TEST_JIRA_CLI, "native Jira CLI required");
  test.setTimeout(120000);
  const data = await mkdtemp(`${tmpdir()}/jira-project-selection-`);
  const fixture = await gitFixture();
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  let deny = false;
  let empty = false;
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    const path = new URL(req.url!, "http://localhost").pathname;
    if (path.endsWith("/myself")) res.end(JSON.stringify({ name: "alice" }));
    else if (deny) { res.statusCode = 403; res.end("{}"); }
    else if (path.endsWith("/project")) res.end(JSON.stringify(empty ? [] : [{ id: "10", key: "A", name: "项目甲" }, { id: "20", key: "B", name: "项目乙" }]));
    else if (path.endsWith("/issuetype")) res.end(JSON.stringify([{ id: "1", name: "Bug" }, { id: "2", name: "Task" }]));
    else if (req.url?.includes("/search")) res.end(JSON.stringify({ startAt: 0, total: 1, maxResults: 1, issues: [{ id: "1", key: "A-1", fields: { summary: "fixture", assignee: { name: "alice" } } }] }));
    else if (req.url?.includes("/issue/A-1")) res.end(JSON.stringify({ key: "A-1", fields: { assignee: { name: "alice" } } }));
    else { res.statusCode = 404; res.end("{}"); }
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const configFile = join(data, "jira.yml");
    await writeFile(configFile, `installation: Local\nserver: ${base}\nlogin: alice\nproject:\n  key: A\n  type: classic\nissue:\n  types:\n    - id: "1"\n      name: Bug\n    - id: "2"\n      name: Task\n`);
    app = await electron.launch({ executablePath: process.env.PLATFORM_EXECUTABLE, args: process.env.PLATFORM_EXECUTABLE ? [] : ["."], env: { ...process.env, PLATFORM_E2E: "1", PLATFORM_DATA_DIR: data, HOME: data, USERPROFILE: data, JIRA_API_TOKEN: "fixture-password", JIRA_AUTH_TYPE: "basic" } });
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "项目管理", exact: true }).click();
    await page.getByRole("button", { name: "添加项目", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "添加项目" });
    await editor.getByLabel("项目名称", { exact: true }).fill("单选项目");
    await editor.getByLabel("分析目录", { exact: true }).fill(fixture.analysis);
    await editor.getByLabel("分析分支").fill("main");
    await editor.getByRole("button", { name: "添加 Jira 范围" }).click();
    await expect(editor.getByLabel("Jira 登录方式")).toBeVisible();
    await editor.getByLabel("Jira 登录方式").selectOption(mode);
    await editor.getByLabel("平台地址").fill(base);
    if (mode === "account") {
      await editor.getByLabel("登录账号").fill("alice");
      await editor.getByLabel("登录密码").fill("fixture-password");

    } else {
      await editor.getByLabel("Jira 可执行文件").fill(process.env.PLATFORM_TEST_JIRA_CLI!);
      await editor.getByLabel("Jira CLI 配置文件").fill(configFile);

    }
    await editor.getByRole("button", {name:"登录并读取 Jira 项目",exact:true}).click();
    const picker = editor.getByRole("combobox", { name: "Jira 项目", exact: true });
    await expect(picker).toBeEnabled();
    await expect(editor.getByLabel("搜索 Jira 项目", { exact: true })).toHaveCount(0);
    await expect(editor.getByLabel("项目 Key", { exact: true })).toHaveCount(0);
    await expect(editor.getByLabel("负责人", { exact: true })).toHaveCount(0);
    await picker.fill("没有匹配的项目");
    await expect(editor.getByText("未找到匹配的 Jira 项目", { exact: true })).toBeVisible();
    await picker.press("Enter");
    await expect(editor).toBeVisible();
    await picker.fill("乙");
    await expect(editor.getByRole("option", { name: "项目甲（A）", exact: true })).toHaveCount(0);
    await expect(editor.getByRole("option", { name: "项目乙（B）", exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("jira-project-selection.png") });
    await editor.getByRole("option", { name: "项目乙（B）", exact: true }).click();
    await expect(picker).toHaveValue("项目乙（B）");
    await expect(picker).toHaveAttribute("aria-expanded", "false");
    await picker.click();
    await expect(editor.getByRole("listbox", { name: "匹配的 Jira 项目" })).toBeVisible();
    await picker.press("Enter");
    await expect(picker).toHaveValue("项目乙（B）");
    await picker.click();
    await picker.press("Escape");
    await expect(editor.getByRole("listbox", { name: "匹配的 Jira 项目" })).toHaveCount(0);
    await editor.getByRole("button", {name:mode==="cli"?"保存本地 Jira 连接":"保存 Jira 连接",exact:true}).click();
    await expect(editor.getByLabel("Jira 项目连接")).toHaveValue(/.+/);
    await expect(editor.getByRole("combobox", {name:"Jira 项目",exact:true})).toHaveCount(0);
    await editor.getByRole("button", { name: "保存项目", exact: true }).click();
    await expect(editor).toHaveCount(0);
    const state = await page.evaluate(async () => { const r = await window.platform.listProjects(); if (!r.ok) throw new Error(r.error.message); return r.value; });
    expect(state[0].issueBindings).toHaveLength(1);
    expect(state[0].issueBindings[0]).toMatchObject({ projectKey: "B", owner: "alice", issueTypeIds: ["1"] });
    const invalidOwner = await page.evaluate(async () => {
      const result = await window.platform.listProjects();
      if (!result.ok) throw new Error(result.error.message);
      const p = result.value[0];
      return window.platform.saveProject({ id: p.id, name: p.name, enabled: p.enabled, repositories: p.repositories.map((r) => ({ path: r.canonicalPath, branch: r.branch, remoteName: r.remoteName, role: r.role })), documents: p.documents, aiProfileId: p.aiProfileId, issueBindings: p.issueBindings.map((b) => ({ ...b, owner: "bob" })) }, p.revision);
    });
    expect(invalidOwner.ok).toBe(false);
    if (!invalidOwner.ok) expect(invalidOwner.error.code).toBe("JIRA_SELECTION_INVALID");
    deny=true;
    await page.getByRole("button",{name:"管理关联",exact:true}).click();
    const links=page.getByRole("dialog",{name:"管理项目关联",exact:true});
    await expect(links.getByLabel("Jira 项目连接")).toHaveValue(state[0].issueBindings[0].connectionId!);
    await expect(links.getByRole("combobox",{name:"Jira 项目",exact:true})).toHaveCount(0);
    await links.getByRole("button",{name:"保存关联",exact:true}).click();await expect(links).toHaveCount(0);
    await page.getByRole("button",{name:"设置",exact:true}).click();
    await page.getByRole("button",{name:"编辑 / 重新登录",exact:true}).click();
    if(mode==="account")await page.getByLabel("登录密码",{exact:true}).fill("fixture-password");
    await page.getByRole("button",{name:"登录并读取 Jira 项目",exact:true}).click();
    await expect(page.getByRole("alert")).toContainText("403");
    deny=false;empty=true;
    await page.getByRole("button",{name:"登录并读取 Jira 项目",exact:true}).click();
    await expect(page.getByRole("combobox",{name:"Jira 项目",exact:true})).toBeEnabled();
    await page.getByRole("combobox",{name:"Jira 项目",exact:true}).fill("不存在");
    await expect(page.getByText("未找到匹配的 Jira 项目",{exact:true})).toBeVisible();
  } finally {
    if (app) await app.close(); server.close(); await once(server, "close");
    await fixture.dispose(); await rm(data, { recursive: true, force: true });
  }
});
