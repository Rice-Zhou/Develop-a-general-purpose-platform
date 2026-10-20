import { test, expect, _electron as electron } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { DataStore } from "../../packages/storage/src/database";
import { gitFixture } from "../../packages/testkit/src/git-fixture";

test("manages documents per project while preserving source files and historical evidence", async () => {
  test.setTimeout(90000);
  const data = await mkdtemp(join(tmpdir(), "project-documents-desktop-"));
  const fixture = await gitFixture();
  const docx = join(data, "需求.docx"), pdf = join(data, "需求.pdf");
  await copyFile(resolve("packages/testkit/fixtures/documents/requirements.docx"), docx);
  await copyFile(resolve("packages/testkit/fixtures/documents/requirements.pdf"), pdf);
  const original = await readFile(docx);
  const projectId = randomUUID(), otherId = randomUUID();
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    const store = await DataStore.open(join(data, "platform.db"));
    try {
      const project = { id: projectId, revision: 1, name: "文档项目 A", enabled: true, updatedAt: "2026-10-19", documents: [{ id: randomUUID(), kind: "docx" as const, locator: docx, required: true }], repositories: [fixture.binding], aiProfileId: null, issueBindings: [{ id: randomUUID(), connectionId: randomUUID(), platform: "jira-dc" as const, instanceUrl: "https://unavailable.example", projectKey: "A", owner: "alice", issueTypeIds: ["1"] }] };
      store.saveProject(project);
      store.saveProject({ ...project, id: otherId, name: "文档项目 B", repositories: [{ ...fixture.binding, id: randomUUID(), canonicalPath: fixture.seed }], issueBindings: [] });
    } finally { store.close(); }
    const launch = () => electron.launch({ executablePath: process.env.PLATFORM_EXECUTABLE!, args: [], env: { ...process.env, HOME: data, USERPROFILE: data, APPDATA: data, PLATFORM_DATA_DIR: data, PLATFORM_E2E: "1" } });
    app = await launch();
    let page = await app.firstWindow();
    await page.getByRole("button", { name: "需求核对", exact: true }).click();
    await page.getByRole("button", { name: "管理需求文档", exact: true }).click({ timeout: 5000 });
    let dialog = page.getByRole("dialog", { name: "管理需求文档", exact: true });
    await expect(dialog.getByText("文档项目 A", { exact: true })).toBeVisible();
    await dialog.getByRole("checkbox", { name: "需求.docx", exact: true }).uncheck();
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    // Capture original evidence before changing the project's configured sources.
    await page.getByRole("button", { name: "准备文档上下文", exact: true }).click();
    await expect(page.getByText("用户必须输入密码后才能登录。", { exact: true }).first()).toBeVisible({ timeout: 40000 });
    const old = await page.evaluate(async id => {
      const r = await window.platform.getWorkspace(id);
      if (!r.ok || !r.value.context) throw new Error("context not prepared");
      return { contextId: r.value.context.id, documentId: r.value.documents[0].id, blockId: r.value.documents[0].blocks[0].id };
    }, projectId);
    await app.evaluate(({ dialog }, paths) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths }); }, [docx, pdf]);
    await page.getByRole("button", { name: "管理需求文档", exact: true }).click();
    await expect(dialog.getByRole("checkbox", { name: "需求.docx", exact: true })).toBeChecked();
    await dialog.getByRole("checkbox", { name: "需求.docx", exact: true }).uncheck();
    await dialog.getByRole("button", { name: "从本机添加 Word / PDF", exact: true }).click();
    await expect(dialog.getByRole("checkbox", { name: "需求.pdf", exact: true })).toBeChecked();
    await dialog.getByRole("button", { name: "添加需求文档资源", exact: true }).click();
    const third = page.getByRole("dialog", { name: "添加需求文档资源", exact: true });
    await third.getByLabel("需求文档名称").fill("飞书需求");
    await third.getByLabel("文档类型").selectOption("feishu");
    await third.getByLabel("文档路径或链接").fill("https://example.feishu.cn/docx/fixture");
    await third.getByRole("button", { name: "保存需求文档资源", exact: true }).click();
    await expect(third).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "保存文档配置", exact: true }).click();
    await expect(dialog.getByRole("alert")).toHaveCount(0); await expect(dialog).toHaveCount(0).catch(async error => { throw new Error(await dialog.innerText() + String(error)); });
    await expect(page.getByText("已关联 3 份需求文档", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "管理需求文档", exact: true }).click();
    await expect(dialog.getByRole("checkbox", { name: "飞书需求", exact: true })).toBeChecked();
    while (await dialog.locator('input[type="checkbox"]:checked').count()) await dialog.locator('input[type="checkbox"]:checked').first().uncheck();
    await dialog.getByRole("button", { name: "保存文档配置", exact: true }).click();
    await expect(dialog.getByRole("alert")).toHaveCount(0); await expect(dialog).toHaveCount(0).catch(async error => { throw new Error(await dialog.innerText() + String(error)); });
    await expect(page.getByText("已关联 0 份需求文档", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "准备文档上下文", exact: true }).click();
    await expect.poll(async () => page.evaluate(async ({ id, previous }) => { const r = await window.platform.getWorkspace(id); return r.ok && Boolean(r.value.context && r.value.context.id !== previous); }, { id: projectId, previous: old.contextId }), { timeout: 40000 }).toBe(true);
    const state = await page.evaluate(async ({ projectId, old }) => {
      const workspace = await window.platform.getWorkspace(projectId);
      const projects = await window.platform.listProjects();
      const historical = await window.platform.readDocumentBlock(projectId, old.contextId, old.documentId, old.blockId);
      if (!workspace.ok || !projects.ok || !historical.ok) throw new Error("history or project read failed");
      return { documents: workspace.value.documents, projects: projects.value, text: historical.value.text };
    }, { projectId, old });
    expect(state.documents).toEqual([]);
    expect(state.projects.find(p => p.id === otherId)!.documents).toHaveLength(1);
    expect(state.text).not.toBe("");
    expect(await readFile(docx)).toEqual(original);
    await app.close();
    app = await launch(); page = await app.firstWindow();
    await page.getByRole("button", { name: "需求核对", exact: true }).click();
    await expect(page.getByText("已关联 0 份需求文档", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "管理需求文档", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "管理需求文档", exact: true });
    await expect(dialog.getByLabel("文档路径或链接")).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath("project-documents.png") });
  } finally { await app?.close(); await fixture.dispose(); await rm(data, { recursive: true, force: true }); }
});
