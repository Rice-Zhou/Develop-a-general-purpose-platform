import { z } from "zod";
import { gt, valid, prerelease } from "semver";
import { AppError } from "../../../contracts/src/error";
import {
  UpdateManifestSchema,
  type ReleaseCheck,
  type ReleaseProvider,
} from "../../../contracts/src/updates";
import { fetchDirect } from "../network/policy";
export const UPDATE_REPOSITORY = "Rice-Zhou/Develop-a-general-purpose-platform";
export type UpdateTransport = typeof fetch;
const officialCdn = new Set([
  "release-assets.githubusercontent.com",
  "objects.githubusercontent.com",
  "github-releases.githubusercontent.com",
]);
export function assertAssetUrl(
  value: string,
  repo = UPDATE_REPOSITORY,
  initial = false,
): URL {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    (url.hostname !== "github.com" &&
      !(!initial && officialCdn.has(url.hostname))) ||
    (url.hostname === "github.com" &&
      !url.pathname.startsWith(`/${repo}/releases/download/`))
  )
    throw new AppError(
      "UPDATE_URL_DENIED",
      "更新附件地址不在允许的 GitHub Release 来源内",
    );
  return url;
}
export async function assetResponse(
  url: string,
  signal: AbortSignal,
  transport: UpdateTransport = fetchDirect as unknown as UpdateTransport,
): Promise<Response> {
  assertAssetUrl(url, UPDATE_REPOSITORY, true);
  for (let redirects = 0; redirects <= 5; redirects++) {
    assertAssetUrl(url);
    const response = await transport(url, { signal, redirect: "manual" });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const target = response.headers.get("location");
      await response.body?.cancel();
      if (!target || redirects === 5)
        throw new AppError(
          "UPDATE_REDIRECT_INVALID",
          "更新下载重定向缺失或超限",
        );
      url = new URL(target, url).href;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new AppError(
        "UPDATE_HTTP_FAILED",
        `更新下载失败（HTTP ${response.status}）`,
      );
    }
    return response;
  }
  throw new AppError("UPDATE_REDIRECT_INVALID", "更新下载重定向超限");
}
async function json(response: Response, limit: number) {
  if (!response.body)
    throw new AppError("UPDATE_RESPONSE_INVALID", "更新服务未返回内容");
  let size = 0;
  const chunks: Uint8Array[] = [];
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.length;
    if (size > limit) {
      throw new AppError("UPDATE_RESPONSE_INVALID", "更新元数据超过大小限制");
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new AppError("UPDATE_RESPONSE_INVALID", "更新元数据不是有效 JSON");
  }
}
const asset = z.object({
  name: z.string(),
  browser_download_url: z.url(),
  size: z.number().optional(),
});
const releaseSchema = z.object({
  id: z.number().int().positive(),
  tag_name: z.string(),
  html_url: z.url(),
  body: z.string().nullable(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  assets: z.array(asset).max(100),
});
export class GitHubReleaseProvider implements ReleaseProvider {
  constructor(
    private readonly transport: UpdateTransport = fetchDirect as unknown as UpdateTransport,
  ) {}
  async check(
    currentVersion: string,
    signal: AbortSignal,
  ): Promise<ReleaseCheck> {
    const response = await this.transport(
      `https://api.github.com/repos/${UPDATE_REPOSITORY}/releases/latest`,
      {
        signal,
        redirect: "error",
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "LocalDevPlatform",
        },
      },
    );
    if (response.status === 404) {
      await response.body?.cancel();
      const repo = await this.transport(
        `https://api.github.com/repos/${UPDATE_REPOSITORY}`,
        { signal, redirect: "error" },
      );
      await repo.body?.cancel();
      if (repo.status === 200) return { kind: "no-release" };
      throw new AppError(
        "UPDATE_REPOSITORY_UNAVAILABLE",
        `更新仓库不可访问（HTTP ${repo.status}）`,
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new AppError(
        "UPDATE_CHECK_FAILED",
        `GitHub 更新检查失败（HTTP ${response.status}），请检查访问权限或 API 限流`,
      );
    }
    const parsed = releaseSchema.safeParse(
      await json(response, 2 * 1024 * 1024),
    );
    if (!parsed.success)
      throw new AppError("UPDATE_RELEASE_INVALID", "GitHub Release 元数据无效");
    const release = parsed.data;
    const version = release.tag_name.replace(/^v/, "");
    if (!valid(version) || prerelease(version))
      throw new AppError("UPDATE_RELEASE_INVALID", "Release 标签不是正式版本");
    if (release.draft || release.prerelease || !gt(version, currentVersion))
      return { kind: "current", version: currentVersion };
    const prefix = `https://github.com/${UPDATE_REPOSITORY}/releases/download/${release.tag_name}/`;
    const find = (name: string) => {
      const items = release.assets.filter((a) => a.name === name);
      if (items.length !== 1 || items[0].browser_download_url !== prefix + name)
        throw new AppError(
          "UPDATE_ASSET_INVALID",
          `Release 缺失或包含无效附件：${name}`,
        );
      return items[0];
    };
    const metadata = find("platform-update.json"),
      installer = find("LocalDevPlatformSetup.exe");
    const raw = await json(
      await assetResponse(
        metadata.browser_download_url,
        signal,
        this.transport,
      ),
      65536,
    );
    const manifest = UpdateManifestSchema.safeParse(raw);
    if (
      !manifest.success ||
      manifest.data.version !== version ||
      manifest.data.size !== installer.size
    )
      throw new AppError(
        "UPDATE_MANIFEST_INVALID",
        "更新清单的版本、平台、大小或校验值与 Release 不一致",
      );
    const releaseUrl = `https://github.com/${UPDATE_REPOSITORY}/releases/tag/${release.tag_name}`;
    if (release.html_url !== releaseUrl)
      throw new AppError("UPDATE_RELEASE_INVALID", "Release 页面地址不匹配");
    return {
      kind: "available",
      offer: {
        id: `${release.id}:${manifest.data.sha256}`,
        version,
        releaseUrl,
        notes: (release.body ?? "").slice(0, 20000),
        manifest: manifest.data,
        assetUrl: installer.browser_download_url,
      },
    };
  }
}
