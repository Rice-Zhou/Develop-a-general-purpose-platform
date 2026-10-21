import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { AppError } from "../../../../packages/contracts/src/error";
import type { InstallRequest } from "./update-helper";
export async function installVerifiedUpdate(
  offer: { id: string; version: string },
  verified: { offerId: string },
  ports: {
    verify: () => Promise<void>;
    freeze: () => Promise<void>;
    stop: () => Promise<void>;
    prepare: () => Promise<void>;
    markRestartRequired: () => void;
    quit: () => void;
  },
): Promise<void> {
  if (offer.id !== verified.offerId)
    throw new AppError("UPDATE_OFFER_CHANGED", "更新包与当前版本不符");
  await ports.verify();
  await ports.freeze();
  try {
    await ports.stop();
    await ports.prepare();
    ports.quit();
  } catch (e) {
    ports.markRestartRequired();
    throw e;
  }
}
export function installationMode(
  executable: string,
  packaged: boolean,
): "installed" | "portable" | "development" {
  if (!packaged) return "development";
  const folder = dirname(executable),
    root = dirname(folder);
  return /^app-\d+\.\d+\.\d+/.test(basename(folder)) &&
    existsSync(join(root, "Update.exe")) &&
    existsSync(join(root, "packages"))
    ? "installed"
    : "portable";
}
export class InstallerHandoff {
  constructor(
    private readonly executable: string,
    private readonly helperPath: string,
  ) {}
  prepare(request: InstallRequest): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        this.executable,
        [this.helperPath, "--handoff", JSON.stringify(request)],
        {
          env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
          detached: true,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let settled = false,
        output = "";
      const timer = setTimeout(
        () =>
          fail(
            new AppError(
              "UPDATE_HELPER_TIMEOUT",
              "安装交接程序准备超时，请重启客户端后重试",
            ),
          ),
        30000,
      );
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill();
        reject(error);
      };
      child.once("error", () =>
        fail(
          new AppError(
            "UPDATE_HELPER_FAILED",
            "无法启动安装交接程序，请重启客户端后重试",
          ),
        ),
      );
      child.once("exit", () =>
        fail(
          new AppError("UPDATE_HELPER_FAILED", "安装交接程序在准备完成前退出"),
        ),
      );
      child.stdout?.on("data", (chunk) => {
        output += String(chunk);
        if (output.length > 1024)
          return fail(
            new AppError("UPDATE_HELPER_INVALID", "安装交接程序返回无效响应"),
          );
        if (output.includes("ready\n")) {
          settled = true;
          clearTimeout(timer);
          child.stdout?.destroy();
          child.stderr?.destroy();
          child.unref();
          resolve();
        }
      });
    });
  }
}
