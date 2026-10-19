import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitFixture, git } from "../../packages/testkit/src/git-fixture";

test("branch detection requires confirmation and preserves manual configuration without switching Git", async () => {
  const data = await mkdtemp(join(tmpdir(), "platform-branches-"));
  const fixture = await gitFixture();
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    const executablePath = process.env.PLATFORM_EXECUTABLE;
    app = await electron.launch({
      ...(executablePath ? { executablePath, args: [] } : { args: ["."] }),
      env: { ...process.env, PLATFORM_DATA_DIR: data, PLATFORM_E2E: "1" },
    });
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "项目管理", exact: true }).click();
    await page.getByRole("button", { name: "添加项目", exact: true }).click();
    await page.getByLabel("项目名称").fill("分支确认项目");
    await writeFile(join(fixture.analysis, "feature.txt"), "developer changes");
    await page.getByLabel("分析目录", { exact: true }).fill(fixture.analysis);
    await expect(
      page.getByText("当前分支：main", { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("分析分支")).toHaveValue("");
    await page.getByRole("button", { name: "使用当前分支" }).click();
    await expect(page.getByLabel("分析分支")).toHaveValue("main");

    git(fixture.analysis, "switch", "-c", "feature/local");
    await page.getByRole("button", { name: "重新读取", exact: true }).click();
    await expect(
      page.getByText("当前分支：feature/local", { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("分析分支")).toHaveValue("main");
    await page.getByLabel("分析分支").fill("release/custom");
    await page.getByRole("button", { name: "保存项目", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "分支确认项目", exact: true }),
    ).toBeVisible();
    const saved = await page.evaluate(async () => {
      const result = await window.platform.listProjects();
      if (!result.ok) throw new Error(result.error.message);
      return result.value[0].repositories[0].branch;
    });
    expect(saved).toBe("release/custom");
    expect(git(fixture.analysis, "branch", "--show-current")).toBe(
      "feature/local",
    );
    expect(await readFile(join(fixture.analysis, "feature.txt"), "utf8")).toBe(
      "developer changes",
    );

    await page.getByRole("button", { name: "添加项目", exact: true }).click();
    git(fixture.analysis, "switch", "--detach");
    await page.getByLabel("分析目录", { exact: true }).fill(fixture.analysis);
    await expect(
      page.getByText("当前为 detached HEAD，请手动配置分支"),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "使用当前分支" }),
    ).toHaveCount(0);
    await page.getByLabel("分析分支").fill("main");
    await page
      .getByLabel("分析目录", { exact: true })
      .fill(join(fixture.analysis, "missing"));
    await expect(
      page.getByText("当前分支读取失败", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByLabel("分析分支")).toHaveValue("main");
  } finally {
    await app?.close();
    await fixture.dispose();
    await rm(data, { recursive: true, force: true });
  }
});
