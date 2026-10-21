import { createReadStream } from "node:fs";
import { stat, writeFile, rename } from "node:fs/promises";
import { basename, dirname, resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { AppError } from "../packages/contracts/src/error";
import {
  UpdateManifestSchema,
  type UpdateManifest,
} from "../packages/contracts/src/updates";
export async function generateUpdateManifest({
  version,
  installerPath,
  outputPath,
}: {
  version: string;
  installerPath: string;
  outputPath: string;
}): Promise<UpdateManifest> {
  const dir = dirname(resolve(installerPath));
  if (
    basename(installerPath) !== "LocalDevPlatformSetup.exe" ||
    resolve(outputPath) !== join(dir, "platform-update.json") ||
    basename(resolve(dir, "../../..")) !== version ||
    basename(dir) !== "x64" ||
    basename(dirname(dir)) !== "squirrel.windows"
  )
    throw new AppError(
      "UPDATE_BUILD_INVALID",
      "只允许从本次版本目录中的最终 x64 安装包生成清单",
    );
  const info = await stat(installerPath);
  if (!info.isFile())
    throw new AppError("UPDATE_BUILD_INVALID", "安装包不是普通文件");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(installerPath)) hash.update(chunk);
  const manifest = UpdateManifestSchema.parse({
    schemaVersion: 1,
    version,
    platform: "win32",
    arch: "x64",
    assetName: "LocalDevPlatformSetup.exe",
    size: info.size,
    sha256: hash.digest("hex"),
  });
  await writeFile(
    outputPath + ".part",
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8",
  );
  await rename(outputPath + ".part", outputPath);
  return manifest;
}
