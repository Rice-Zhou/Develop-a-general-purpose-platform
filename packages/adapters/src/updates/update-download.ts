import { mkdir, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { AppError } from "../../../contracts/src/error";
import {
  UpdateManifestSchema,
  type UpdateOffer,
} from "../../../contracts/src/updates";
import { assetResponse, type UpdateTransport } from "./github-release";
export interface VerifiedUpdate {
  offerId: string;
  path: string;
  size: number;
  sha256: string;
}
export type UpdateDownloader = (
  offer: UpdateOffer,
  cacheRoot: string,
  signal: AbortSignal,
  onProgress: (bytes: number) => void,
) => Promise<VerifiedUpdate>;
export const DOWNLOAD_TOTAL_MS = 20 * 60 * 1000,
  DOWNLOAD_IDLE_MS = 30000;
export async function downloadVerified(
  offer: UpdateOffer,
  cacheRoot: string,
  signal: AbortSignal,
  onProgress: (bytes: number) => void,
  transport?: UpdateTransport,
): Promise<VerifiedUpdate> {
  const manifest = UpdateManifestSchema.parse(offer.manifest);
  signal.throwIfAborted();
  const local = new AbortController(),
    combined = AbortSignal.any([
      signal,
      local.signal,
      AbortSignal.timeout(DOWNLOAD_TOTAL_MS),
    ]);
  let idle: NodeJS.Timeout | undefined;
  const reset = () => {
    clearTimeout(idle);
    idle = setTimeout(
      () =>
        local.abort(
          new AppError("UPDATE_DOWNLOAD_TIMEOUT", "更新下载超过 30 秒无数据"),
        ),
      DOWNLOAD_IDLE_MS,
    );
  };
  const directory = join(cacheRoot, randomUUID()),
    part = join(directory, "LocalDevPlatformSetup.exe.part"),
    path = join(directory, "LocalDevPlatformSetup.exe");
  await mkdir(directory, { recursive: true });
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let promoted = false;
  try {
    reset();
    const response = await assetResponse(offer.assetUrl, combined, transport);
    const length = response.headers.get("content-length");
    if (length !== null && Number(length) !== manifest.size) {
      await response.body?.cancel();
      throw new AppError(
        "UPDATE_SIZE_MISMATCH",
        "更新包 Content-Length 与清单大小不符",
      );
    }
    if (!response.body)
      throw new AppError("UPDATE_DOWNLOAD_EMPTY", "更新服务未返回安装包");
    handle = await open(part, "wx");
    let size = 0;
    const hash = createHash("sha256");
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      combined.throwIfAborted();
      reset();
      size += chunk.length;
      if (size > manifest.size)
        throw new AppError("UPDATE_SIZE_MISMATCH", "更新包超过清单大小");
      hash.update(chunk);
      await handle.writeFile(chunk);
      onProgress(size);
    }
    combined.throwIfAborted();
    const sha256 = hash.digest("hex");
    if (size !== manifest.size || sha256 !== manifest.sha256)
      throw new AppError(
        "UPDATE_VERIFICATION_FAILED",
        "更新包大小或 SHA-256 校验失败，请重新下载",
      );
    await handle.sync();
    await handle.close();
    handle = undefined;
    combined.throwIfAborted();
    await rename(part, path);
    combined.throwIfAborted();
    promoted = true;
    return { offerId: offer.id, path, size, sha256 };
  } finally {
    clearTimeout(idle);
    await handle?.close();
    if (!promoted) await rm(directory, { recursive: true, force: true });
  }
}
