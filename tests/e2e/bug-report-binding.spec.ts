import { test, expect } from "@playwright/test";
import { reportFixture } from "./report-fixture";
test("opens only the selected issue report and explains a missing report without an AI connection", async () => {
  const f = await reportFixture();
  try {
    const card = (key: string) =>
      f.page
        .locator("article.finding-card")
        .filter({ has: f.page.getByRole("link", { name: key, exact: true }) });
    await card("A-3")
      .getByRole("button", { name: "打开分析报告", exact: true })
      .click();
    await expect(card("A-3")).toContainText("当前问题还未分析");
    await card("A-1")
      .getByRole("button", { name: "打开分析报告", exact: true })
      .click();
    await expect(
      f.page.getByRole("heading", { name: "A-1 · Problem 1", exact: true }),
    ).toBeVisible();
    await expect(f.page.getByText("Cause 2", { exact: true })).toHaveCount(0);
    await f.page
      .getByRole("button", { name: "返回 BUG 工作台", exact: true })
      .click();
    await card("A-2")
      .getByRole("button", { name: "打开分析报告", exact: true })
      .click();
    await expect(f.page.getByText("Cause 2", { exact: true })).toBeVisible();
    await expect(
      f.page.getByRole("heading", { name: "BUG 报告历史", exact: true }),
    ).toHaveCount(0);
  } finally {
    await f.dispose();
  }
});
