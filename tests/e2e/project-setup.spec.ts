import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitFixture } from "../../packages/testkit/src/git-fixture";

{
  test("creates a code project with optional resource links and no separate BUG AI setup", async () => {
    const data = await mkdtemp(join(tmpdir(), "platform-project-setup-"));
    const fixture = await gitFixture();
    let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
    try {
      const executablePath = process.env.PLATFORM_EXECUTABLE;
      app = await electron.launch({
        ...(executablePath ? { executablePath, args: [] } : { args: ["."] }),
        env: {
          ...process.env,
          USERPROFILE: data,
          HOME: data,
          PLATFORM_DATA_DIR: data,
          PLATFORM_E2E: "1",
        },
      });
      const page = await app.firstWindow();
      await page.getByRole("button", { name: "项目管理", exact: true }).click();
      await page.getByRole("button", { name: "添加项目", exact: true }).click();
      const editor = page.getByRole("dialog", { name: "添加项目" });
      await expect(editor.getByText("主仓库", { exact: true })).toBeVisible();
      await expect(editor.getByLabel("分析目录", { exact: true })).toHaveCount(
        1,
      );
      await editor.getByRole("button", { name: "添加仓库" }).click();
      await expect(editor.getByLabel("分析目录", { exact: true })).toHaveCount(
        2,
      );
      await editor
        .getByRole("button", { name: "移除", exact: true })
        .last()
        .click();
      await expect(
        editor.getByRole("button", { name: "添加 Jira 范围" }),
      ).toBeVisible();
      await expect(
        editor.getByRole("button", { name: "添加 Trinity 范围" }),
      ).toBeVisible();
      await editor.getByRole("button", { name: "添加 Trinity 范围" }).click();
      await expect(editor.getByLabel("缺陷类型（逗号分隔）")).toHaveValue(
        "BUG",
      );
      await editor.getByRole("button", { name: "移除范围" }).click();
      await editor.getByLabel("项目名称").fill("配置引导项目");
      await editor
        .getByLabel("分析目录", { exact: true })
        .fill(fixture.analysis);
      await editor.getByLabel("分析分支").fill("main");
      await editor
        .getByRole("button", { name: "保存项目", exact: true })
        .click();
      const prompt = page.getByRole("dialog", { name: "配置 BUG AI 预分析" });
      await expect(editor).toHaveCount(0);
      await expect(prompt).toHaveCount(0);
      const state = await page.evaluate(async () => {
        const projects = await window.platform.listProjects();
        const tasks = await window.platform.listTasks();
        if (!projects.ok) throw new Error(projects.error.message);
        if (!tasks.ok) throw new Error(tasks.error.message);
        return { projects: projects.value, tasks: tasks.value };
      });
      expect(state.projects).toHaveLength(1);
      expect(state.projects[0].repositories).toHaveLength(1);
      expect(state.tasks).toHaveLength(0);
      await page.getByRole("button", { name: "项目管理", exact: true }).click();
      await page.getByRole("button", { name: "编辑配置" }).click();
      await page.getByRole("button", { name: "保存项目", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "编辑项目" })).toHaveCount(
        0,
      );
      await expect(prompt).toHaveCount(0);
    } finally {
      if (app) await app.close();
      await fixture.dispose();
      await rm(data, { recursive: true, force: true });
    }
  });
}
