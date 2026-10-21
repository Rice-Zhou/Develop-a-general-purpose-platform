import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
test("prompts once, checks manually, and downloads only after explicit consent", async () => {
  const root = await mkdtemp(join(tmpdir(), "client-update-"));
  const bytes = Buffer.from("isolated installer fixture");
  let downloads = 0,
    fail = false;
  const server = createServer((req, res) => {
    if (req.url === "/asset") {
      downloads++;
      return res.end(bytes);
    }
    res.setHeader("content-type", "application/json");
    if (fail) {
      res.writeHead(403).end();
      return;
    }
    res.end(
      JSON.stringify({
        kind: "available",
        offer: {
          id: "test:hash",
          version: "9.0.0",
          notes: "<b>plain release notes</b>",
          releaseUrl:
            "https://github.com/Rice-Zhou/Develop-a-general-purpose-platform/releases/tag/v9.0.0",
          assetUrl:
            "https://github.com/Rice-Zhou/Develop-a-general-purpose-platform/releases/download/v9.0.0/LocalDevPlatformSetup.exe",
          manifest: {
            schemaVersion: 1,
            version: "9.0.0",
            platform: "win32",
            arch: "x64",
            assetName: "LocalDevPlatformSetup.exe",
            size: bytes.length,
            sha256: createHash("sha256").update(bytes).digest("hex"),
          },
        },
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const app = await electron.launch({
    executablePath: process.env.PLATFORM_EXECUTABLE!,
    args: [],
    env: {
      ...process.env,
      PLATFORM_E2E: "1",
      PLATFORM_UPDATE_E2E_URL: base,
      PLATFORM_DATA_DIR: root,
      APPDATA: root,
      HOME: root,
      USERPROFILE: root,
    },
  });
  try {
    const page = await app.firstWindow();
    const dialog = page.getByRole("dialog", {
      name: "客户端有新版本",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    expect(downloads).toBe(0);
    await expect(dialog).toContainText("更新后转为安装版");
    await dialog.getByRole("button", { name: "暂不更新", exact: true }).click();
    await page.reload();
    await expect(dialog).toHaveCount(0);
    await page.getByRole("button", { name: "设置", exact: true }).click();
    const panel = page
      .locator("section")
      .filter({
        has: page.getByRole("heading", { name: "客户端更新", exact: true }),
      });
    await panel.getByRole("button", { name: "检查更新", exact: true }).click();
    await expect(panel).toContainText("9.0.0");
    expect(downloads).toBe(0);
    await panel.getByRole("button", { name: "下载更新", exact: true }).click();
    await expect(
      panel.getByRole("button", { name: "安装并重启", exact: true }),
    ).toBeVisible();
    expect(downloads).toBe(1);
    fail = true;
    await panel.getByRole("button", { name: "检查更新", exact: true }).click();
    await expect(panel).toContainText("403");
    await expect(
      panel.getByRole("button", { name: "安装并重启", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath("client-update-ready.png"),
    });
  } finally {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
});
