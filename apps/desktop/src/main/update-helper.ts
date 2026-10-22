import { z } from "zod";
import { createReadStream } from "node:fs";
import { readFile, realpath, stat, writeFile, rename } from "node:fs/promises";
import { relative, isAbsolute, dirname } from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { gte, valid } from "semver";
import { AppError } from "../../../../packages/contracts/src/error";
import { MAX_UPDATE_BYTES } from "../../../../packages/contracts/src/updates";
export const InstallRequestSchema = z
  .object({
    offerId: z.string().min(1).max(200),
    targetVersion: z.string().refine((v) => valid(v) === v),
    cacheRoot: z.string().min(1),
    installerPath: z.string().min(1),
    expectedSize: z.number().int().positive().max(MAX_UPDATE_BYTES),
    expectedSha256: z.string().regex(/^[a-f0-9]{64}$/),
    parentPid: z.number().int().positive(),
    previousClientPath: z.string().min(1),
    resultPath: z.string().min(1),
  })
  .strict();
export type InstallRequest = z.infer<typeof InstallRequestSchema>;
const resultSchema = z
  .object({
    targetVersion: z.string().refine((v) => valid(v) === v),
    state: z.enum(["installer-started", "failed"]),
    message: z.string().max(1000),
  })
  .strict();
function within(root: string, path: string) {
  const delta = relative(root, path);
  if (!delta || delta.startsWith("..") || isAbsolute(delta))
    throw new AppError("UPDATE_PATH_DENIED", "更新文件不在专用缓存目录内");
}
export async function verifyInstaller(request: InstallRequest): Promise<void> {
  InstallRequestSchema.parse(request);
  const root = await realpath(request.cacheRoot);
  within(root, await realpath(request.installerPath));
  const resultDirectory = await realpath(dirname(request.resultPath));
  if (resultDirectory !== root)
    throw new AppError("UPDATE_PATH_DENIED", "更新结果路径无效");
  const info = await stat(request.installerPath);
  if (!info.isFile() || info.size !== request.expectedSize)
    throw new AppError(
      "UPDATE_VERIFICATION_FAILED",
      "安装包已变化，请重新下载",
    );
  const hash = createHash("sha256");
  for await (const part of createReadStream(request.installerPath))
    hash.update(part);
  if (hash.digest("hex") !== request.expectedSha256)
    throw new AppError("UPDATE_VERIFICATION_FAILED", "安装包 SHA-256 校验失败");
}
export async function readHandoffResult(
  path: string,
  currentVersion: string,
): Promise<{ message: string; success: boolean } | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    return {
      success: false,
      message: "安装交接记录无法读取，请在设置中重新检查更新",
    };
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return {
      success: false,
      message: "安装交接记录不完整，请在设置中重新检查更新",
    };
  }
  const result = resultSchema.safeParse(decoded);
  if (!result.success)
    return {
      success: false,
      message: "安装交接记录无效，请在设置中重新检查更新",
    };
  if (gte(currentVersion, result.data.targetVersion))
    return { success: true, message: `客户端已升级到 ${currentVersion}` };
  return {
    success: false,
    message:
      result.data.state === "failed"
        ? result.data.message
        : `安装器已启动，当前仍为 ${currentVersion}，目标版本 ${result.data.targetVersion}；请完成安装后重启`,
  };
}
async function writeResult(path: string, result: z.infer<typeof resultSchema>) {
  const part = `${path}.${process.pid}.part`;
  await writeFile(part, JSON.stringify(result), "utf8");
  await rename(part, path);
}
export interface HelperPorts {
  alive: (pid: number) => boolean;
  wait: (ms: number) => Promise<void>;
  spawn: (path: string) => Promise<void>;
  relaunch: (path: string) => void;
  now: () => number;
}
export async function runHandoff(
  request: InstallRequest,
  ports: HelperPorts,
): Promise<void> {
  // Schema and destination are validated before writing any helper result.
  InstallRequestSchema.parse(request);
  const root = await realpath(request.cacheRoot);
  if ((await realpath(dirname(request.resultPath))) !== root)
    throw new AppError("UPDATE_PATH_DENIED", "更新结果路径无效");
  let parentExited = false;
  try {
    const deadline = ports.now() + 120000;
    while (ports.alive(request.parentPid)) {
      if (ports.now() >= deadline)
        throw new AppError(
          "UPDATE_PARENT_ALIVE",
          "原客户端未退出，未启动安装器",
        );
      await ports.wait(300);
    }
    parentExited = true;
    await verifyInstaller(request);
    await ports.spawn(request.installerPath);
    await writeResult(request.resultPath, {
      targetVersion: request.targetVersion,
      state: "installer-started",
      message: "安装器已启动，等待安装完成",
    });
  } catch (e) {
    await writeResult(request.resultPath, {
      targetVersion: request.targetVersion,
      state: "failed",
      message:
        e instanceof AppError
          ? e.message
          : "更新安装交接失败，请重启后重新下载并重试",
    });
    if (parentExited) ports.relaunch(request.previousClientPath);
  }
}
export function spawnDetached(
  path: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  // Node mode belongs to this helper, never to the installer or its desktop children.
  const desktopEnv = { ...env };
  delete desktopEnv.ELECTRON_RUN_AS_NODE;
  return new Promise((resolve, reject) => {
    const child = spawn(path, [], {
      detached: true,
      windowsHide: true,
      stdio: "ignore",
      env: desktopEnv,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
async function cli() {
  if (process.argv.includes("--self-test")) {
    process.stdout.write("update-helper-ok\n");
    return;
  }
  const index = process.argv.indexOf("--handoff");
  if (index < 0) return;
  const request = InstallRequestSchema.parse(
    JSON.parse(process.argv[index + 1]),
  );
  await verifyInstaller(request);
  process.stdout.write("ready\n");
  await runHandoff(request, {
    alive: (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ESRCH") return false;
        throw e;
      }
    },
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
    spawn: (path) => spawnDetached(path),
    relaunch: (path) => {
      void spawnDetached(path).catch((e) => {
        console.error(
          "previous client restart failed",
          (e as NodeJS.ErrnoException).code,
        );
      });
    },
    now: Date.now,
  });
}
if (process.argv.includes("--handoff") || process.argv.includes("--self-test"))
  void cli().catch((e) => {
    console.error(e instanceof AppError ? e.code : "UPDATE_HELPER_FAILED");
    process.exitCode = 1;
  });
