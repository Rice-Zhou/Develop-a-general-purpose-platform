import { test, expect } from "@playwright/test";
import { reportFixture } from "./report-fixture";
test("a late report response cannot reopen a report after navigation", async () => {
  const f = await reportFixture();
  try {
    await f.app.evaluate(({ ipcMain }) => {
      const handlers = (
        ipcMain as unknown as {
          _invokeHandlers: Map<
            string,
            (e: unknown, i: { method: string }) => unknown
          >;
        }
      )._invokeHandlers;
      const original = handlers.get("platform:request")!;
      ipcMain.removeHandler("platform:request");
      ipcMain.handle("platform:request", async (e, i) => {
        if (i.method === "getBugReport")
          await new Promise((r) => setTimeout(r, 800));
        return original(e, i);
      });
    });
    const page = f.page;
    await page
      .locator("article.finding-card")
      .filter({ has: page.getByRole("link", { name: "A-1", exact: true }) })
      .getByRole("button", { name: "打开分析报告", exact: true })
      .click();
    await page.getByRole("button", { name: "任务列表", exact: true }).click();
    await page.waitForTimeout(1100);
    await expect(
      page.getByRole("heading", { name: "BUG 预分析报告", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /当前任务/ })).toBeVisible();
  } finally {
    await f.dispose();
  }
});
