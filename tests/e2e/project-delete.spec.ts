import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitFixture } from "../../packages/testkit/src/git-fixture";
test("project deletion confirms, blocks active work, preserves code and releases its binding", async () => {
  const data = await mkdtemp(join(tmpdir(), "platform-delete-"));
  const f = await gitFixture();
  const b = await gitFixture();
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    const executablePath = process.env.PLATFORM_EXECUTABLE;
    app = await electron.launch({
      ...(executablePath ? { executablePath, args: [] } : { args: ["."] }),
      env: {
        ...process.env,
        PLATFORM_DATA_DIR: data,
        PLATFORM_E2E: "1",
        USERPROFILE: data,
        HOME: data,
      },
    });
    const page = await app.firstWindow();
    const ids = await page.evaluate(
      async ({ a, b }) => {
        const add = async (name: string, path: string) => {
          const r = await window.platform.saveProject({
            name,
            enabled: true,
            repositories: [
              { path, branch: "main", remoteName: "origin", role: "主仓库" },
            ],
            documents: [],
            issueBindings: [],
            aiProfileId: null,
          });
          if (!r.ok) throw new Error(r.error.message);
          return r.value;
        };
        const first = await add("A", a);
        const second = await add("B", b);
        return { first, second };
      },
      { a: f.analysis, b: b.analysis },
    );
    await page.getByRole("button", { name: "项目管理", exact: true }).click();
    const card = page
      .locator(".project-card")
      .filter({ has: page.getByRole("heading", { name: "A", exact: true }) });
    await card.getByRole("button", { name: "删除项目", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "删除项目", exact: true });
    await expect(dialog.getByText(/保留历史/)).toBeVisible();
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(card).toBeVisible();
    const denied = await page.evaluate(
      async ({ id, revision }) => {
        const task = await window.platform.prepareContext(id);
        if (!task.ok) throw new Error(task.error.message);
        return window.platform.deleteProject(id, revision);
      },
      { id: ids.first.id, revision: ids.first.revision },
    );
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe("PROJECT_BUSY");
    await expect(
      card.getByRole("button", { name: "删除项目", exact: true }),
    ).toBeDisabled();
    await expect(
      card.getByRole("button", { name: "删除项目", exact: true }),
    ).toBeEnabled({ timeout: 30000 });
    await card.getByRole("button", { name: "删除项目", exact: true }).click();
    await dialog.getByRole("button", { name: "确认删除", exact: true }).click();
    await expect(card).toHaveCount(0);
    const state = await page.evaluate(async () => ({
      projects: await window.platform.listProjects(),
      tasks: await window.platform.listTasks(),
    }));
    expect(state.projects.ok && state.projects.value.map((p) => p.id)).toEqual([
      ids.second.id,
    ]);
    expect(state.tasks.ok && state.tasks.value).toEqual([]);
    expect(await readFile(join(f.analysis, "feature.txt"), "utf8")).toBe(
      "initial\n",
    );
    const replacement = await page.evaluate(
      async (path) =>
        window.platform.saveProject({
          name: "C",
          enabled: true,
          repositories: [
            { path, branch: "main", remoteName: "origin", role: "主仓库" },
          ],
          documents: [],
          issueBindings: [],
          aiProfileId: null,
        }),
      f.analysis,
    );
    expect(replacement.ok).toBe(true);
  } finally {
    await app?.close();
    await f.dispose();
    await b.dispose();
    await rm(data, { recursive: true, force: true });
  }
});
