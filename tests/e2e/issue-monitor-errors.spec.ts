import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("notification failure is visible even when monitor settings are collapsed", async () => {
  const data = await mkdtemp(join(tmpdir(), "monitor-error-"));
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    app = await electron.launch({ executablePath: process.env.PLATFORM_EXECUTABLE!, args: [], env: { ...process.env, HOME: data, USERPROFILE: data, APPDATA: data, PLATFORM_DATA_DIR: data } });
    await app.evaluate(({ ipcMain }) => {
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, input: unknown) => Promise<unknown>> })._invokeHandlers;
      const original = handlers.get("platform:request")!;
      ipcMain.removeHandler("platform:request");
      ipcMain.handle("platform:request", async (event, input) => {
        const result = await original(event, input) as { ok: boolean; value?: object };
        if (input.method === "getIssueMonitor" && result.ok) return { ...result, value: { ...result.value, pendingCount: 1, notificationError: { code: "FEISHU_NOTIFICATION_FAILED", message: "飞书消息发送失败，请检查机器人权限", stage: "notification", retryable: true, requiredAction: null, diagnosticRef: null } } };
        return result;
      });
    });
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "BUG 工作台", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("飞书消息发送失败，请检查机器人权限");
    await expect(page.getByText(/定时查询与飞书提醒 ·/)).toContainText("待发送 1");
  } finally { await app?.close(); await rm(data, { recursive: true, force: true }); }
});
