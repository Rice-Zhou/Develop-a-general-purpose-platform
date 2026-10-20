import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { git, gitFixture } from "../../packages/testkit/src/git-fixture";

test("updates code independently and offers manual or configured AI conflict resolution", async () => {
  test.setTimeout(180000);
  const data = await mkdtemp(join(tmpdir(), "code-update-desktop-")); const f = await gitFixture();
  let calls = 0;
  const server = createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    const request = JSON.parse(body) as { messages: { role: string; content: string }[] };
    expect(request.messages.some(m => m.role === "user" && m.content.includes("feature.txt"))).toBe(true);
    calls++; res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ files: [{ path: "feature.txt", content: "AI resolved\n" }] }) } }] }));
  }); server.listen(0, "127.0.0.1"); await once(server, "listening");
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    app = await electron.launch({ executablePath: process.env.PLATFORM_EXECUTABLE!, args: [], env: { ...process.env, HOME: data, USERPROFILE: data, APPDATA: data, PLATFORM_DATA_DIR: data, PLATFORM_E2E: "1" } });
    const page = await app.firstWindow();
    const projectId = await page.evaluate(async path => {
      const r = await window.platform.saveProject({ name: "代码更新测试", enabled: true, repositories: [{ path, branch: "main", remoteName: "origin", role: "main" }], documents: [{ id: crypto.randomUUID(), kind: "pdf", locator: path + "/missing.pdf", required: true }], issueBindings: [], aiProfileId: null });
      if (!r.ok) throw new Error(r.error.message); return r.value.id;
    }, f.analysis);
    const conflict = async (name: string) => {
      await writeFile(join(f.analysis, "feature.txt"), name + " local\n"); git(f.analysis, "add", "."); git(f.analysis, "commit", "-m", name);
      await f.publish(name + " remote\n");
      await page.getByRole("button", { name: "项目管理", exact: true }).click();
      await page.getByRole("button", { name: "更新代码", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "选择冲突处理方式", exact: true })).toBeVisible({ timeout: 45000 });
    };
    await conflict("manual");
    const dialog = page.getByRole("dialog", { name: "选择冲突处理方式", exact: true });
    await expect(dialog.getByRole("button", { name: "AI 解决并继续", exact: true })).toBeDisabled();
    await expect(dialog.getByText("当前项目未配置有效 AI 连接，不能使用 AI 解决冲突。", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "自行解决冲突", exact: true }).click();
    await writeFile(join(f.analysis, "feature.txt"), "manually resolved\n"); git(f.analysis, "add", "feature.txt");
    await dialog.getByRole("button", { name: "已自行解决，继续更新", exact: true }).click();
    await expect.poll(async () => page.evaluate(async id => { const r = await window.platform.listTasks(id); return r.ok ? r.value[0].status : "error"; }, projectId), { timeout: 45000 }).toBe("SUCCEEDED");
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
    await page.evaluate(async ({ base, id }) => {
      const p = await window.platform.saveAIProfile({ name: "local model", kind: "api", baseUrl: base, model: "fixture", outboundEnabled: true }, "fixture-token");
      const projects = await window.platform.listProjects();
      if (!p.ok || !projects.ok) throw new Error("setup failed");
      const project = projects.value.find(p => p.id === id)!;
      const r = await window.platform.saveProject({ id: project.id, name: project.name, enabled: true, repositories: project.repositories.map(r => ({ path: r.canonicalPath, branch: r.branch, remoteName: r.remoteName, role: r.role })), documents: project.documents, issueBindings: [], aiProfileId: p.value.id }, project.revision);
      if (!r.ok) throw new Error(r.error.message);
    }, { base, id: projectId });
    await conflict("ai");
    const latest = () => page.evaluate(async id => { const r = await window.platform.listTasks(id); if (!r.ok) throw new Error(r.error.message); return r.value[0]; }, projectId);
    let decisions = 0;
    for (; decisions < 3;) {
      const previous = await latest();
      await expect(dialog.getByRole("button", { name: "AI 解决并继续", exact: true })).toBeEnabled();
      await dialog.getByRole("button", { name: "AI 解决并继续", exact: true }).click();
      decisions++;
      await expect.poll(async () => (await latest()).id, { timeout: 10000 }).not.toBe(previous.id);
      await expect.poll(async () => ["SUCCEEDED", "WAITING_INPUT", "FAILED"].includes((await latest()).status), { timeout: 45000 }).toBe(true);
      const finished = await latest();
      if (finished.status === "SUCCEEDED") break;
      expect(finished.error?.code).toBe("GIT_REBASE_CONFLICT");
      await expect(dialog).toBeVisible();
    }
    expect((await latest()).status).toBe("SUCCEEDED");
    expect(await readFile(join(f.analysis, "feature.txt"), "utf8")).toBe("AI resolved\n");
    const trace = await page.evaluate(async id => {
      const r = await window.platform.listTasks(id); if (!r.ok) throw new Error(r.error.message);
      return r.value.map(t => ({ id: t.id, kind: t.kind, status: t.status, error: t.error?.code }));
    }, projectId);
    expect(trace.filter(t => t.kind === "RESOLVE_CODE_CONFLICTS"), JSON.stringify(trace)).toHaveLength(decisions);
    expect(calls, JSON.stringify(trace)).toBe(decisions);
    const workspace = await page.evaluate(async id => window.platform.getWorkspace(id), projectId);
    expect(workspace).toMatchObject({ ok: true, value: { context: null } });
    expect(git(f.analysis, "symbolic-ref", "--short", "HEAD")).toBe("main");
  } finally { await app?.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await f.dispose(); await rm(data, { recursive: true, force: true }); }
});
