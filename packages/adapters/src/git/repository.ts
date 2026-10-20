import { createHash, randomUUID } from "node:crypto";
import { realpath, stat, lstat, readFile as readDiskFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, normalize, resolve, relative, dirname } from "node:path";
import { AppError } from "../../../contracts/src/error";
import type {
  FileEntry,
  RepositoryBinding,
  RepositoryBranch,
  RepositoryInspection,
  RepositorySnapshot,
} from "../../../contracts/src/models";
import {
  assertReadablePath,
  readablePath,
} from "../../../core/src/context/access-policy";
import { runGit } from "./git-process";
import { z } from "zod";
const hash = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
export class GitRepositoryAdapter {
  private async rebaseDirectory(binding: RepositoryBinding, signal: AbortSignal): Promise<string | null> {
    await this.readCurrentBranch(binding.canonicalPath, signal);
    const location = await this.text(binding.canonicalPath, ["rev-parse", "--git-path", "rebase-merge"], signal);
    const directory = resolve(binding.canonicalPath, location);
    try { await stat(directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    if ((await readDiskFile(join(directory, "head-name"), "utf8")).trim() !== `refs/heads/${binding.branch}`)
      throw new AppError("BRANCH_MISMATCH", "进行中的 rebase 不属于配置分支", "git");
    const markerPath = await this.text(binding.canonicalPath, ["rev-parse", "--git-path", "local-dev-platform-update.json"], signal);
    let marker;
    try { marker = z.object({ branch: z.string(), original: z.string(), target: z.string() }).parse(JSON.parse(await readDiskFile(resolve(binding.canonicalPath, markerPath), "utf8"))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new AppError("GIT_OPERATION_PENDING", "此 rebase 不是平台发起的，请在仓库中自行完成或中止"); throw error; }
    if (marker.branch !== binding.branch || marker.original !== (await readDiskFile(join(directory, "orig-head"), "utf8")).trim() || marker.target !== (await readDiskFile(join(directory, "onto"), "utf8")).trim())
      throw new AppError("GIT_OPERATION_PENDING", "Rebase 状态与平台更新记录不符，请自行检查");
    return directory;
  }
  private conflictError(binding: RepositoryBinding): AppError {
    return new AppError("GIT_REBASE_CONFLICT", `代码更新在 ${binding.canonicalPath} 遇到 rebase 冲突，请选择自行解决或 AI 解决。`, "git", false, "自行解决后执行 git add，再点击继续更新；也可在仓库中 git rebase --abort 放弃本次 rebase。");
  }
  async update(binding: RepositoryBinding, signal: AbortSignal): Promise<void> {
    if (await this.rebaseDirectory(binding, signal)) throw this.conflictError(binding);
    const { target, relation, inspection } = await this.fetchTarget(binding, signal);
    if (!relation[1]) return;
    if (!relation[0]) {
      await this.text(binding.canonicalPath, ["merge", "--ff-only", "--no-edit", "--no-overwrite-ignore", target], signal);
    } else {
      await this.text(binding.canonicalPath, ["update-ref", `refs/local-dev-platform/updates/${randomUUID()}`, inspection.head], signal);
      const markerPath = await this.text(binding.canonicalPath, ["rev-parse", "--git-path", "local-dev-platform-update.json"], signal);
      await writeFile(resolve(binding.canonicalPath, markerPath), JSON.stringify({ branch: binding.branch, original: inspection.head, target }), "utf8");
      const result = await runGit(binding.canonicalPath, ["-c", "commit.gpgSign=false", "-c", "rebase.autoSquash=false", "-c", "rebase.updateRefs=false", "rebase", "--merge", "--no-autostash", target], signal, [0, 1]);
      if (result.code !== 0) {
        if (await this.rebaseDirectory(binding, signal)) throw this.conflictError(binding);
        throw new AppError("GIT_REBASE_FAILED", "Rebase 失败，请检查仓库后重试", "git");
      }
    }
    this.assertReady(await this.inspect(binding, signal));
  }
  async continueUpdate(binding: RepositoryBinding, signal: AbortSignal): Promise<void> {
    if (await this.rebaseDirectory(binding, signal)) {
      const unresolved = await this.text(binding.canonicalPath, ["diff", "--name-only", "--diff-filter=U"], signal);
      if (unresolved) throw this.conflictError(binding);
      const result = await runGit(binding.canonicalPath, ["-c", "core.editor=true", "-c", "commit.gpgSign=false", "rebase", "--continue"], signal, [0, 1]);
      if (result.code !== 0) throw this.conflictError(binding);
    }
    await this.update(binding, signal);
  }
  private async conflictPath(binding: RepositoryBinding, path: string): Promise<string> {
    assertReadablePath(path);
    const root = await realpath(binding.canonicalPath);
    const full = resolve(root, path);
    if (relative(root, full).startsWith("..") || isAbsolute(relative(root, full))) throw new AppError("PATH_DENIED", "冲突路径越界");
    for (let current = full; current !== root; current = dirname(current)) {
      const info = await lstat(current);
      if (info.isSymbolicLink() || (current === full && (!info.isFile() || info.nlink !== 1 || info.size > 128 * 1024)))
        throw new AppError("CONFLICT_UNSUPPORTED", "AI 仅支持 128 KiB 内的普通文本冲突，其他冲突请自行处理");
    }
    return full;
  }
  async conflicts(binding: RepositoryBinding, signal: AbortSignal) {
    const directory = await this.rebaseDirectory(binding, signal);
    if (!directory) throw new AppError("GIT_NO_REBASE", "当前仓库没有进行中的 rebase");
    const index = (await runGit(binding.canonicalPath, ["ls-files", "--stage", "-z"], signal)).stdout;
    const revision = hash((await this.text(binding.canonicalPath, ["rev-parse", "HEAD", "REBASE_HEAD"], signal)) + hash(index) + await readDiskFile(join(directory, "onto"), "utf8"));
    const paths = (await runGit(binding.canonicalPath, ["diff", "--name-only", "-z", "--diff-filter=U"], signal)).stdout.toString("utf8").split("\0").filter(Boolean);
    if (!paths.length || paths.length > 10) throw new AppError("CONFLICT_UNSUPPORTED", "AI 需要 1～10 个文本冲突文件，其他情况请自行处理");
    const files = [];
    for (const path of paths) {
      const bytes = await readDiskFile(await this.conflictPath(binding, path));
      if (bytes.includes(0)) throw new AppError("CONFLICT_UNSUPPORTED", "二进制冲突请自行处理");
      const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      files.push({ path, content, hash: hash(bytes) });
    }
    return { revision, files };
  }
  async applyConflicts(binding: RepositoryBinding, original: Awaited<ReturnType<GitRepositoryAdapter["conflicts"]>>, files: { path: string; content: string }[], signal: AbortSignal): Promise<void> {
    await this.assertNoEffectiveFilters(binding.canonicalPath, signal);
    const current = await this.conflicts(binding, signal);
    if (JSON.stringify(current) !== JSON.stringify(original) || files.length !== current.files.length || new Set(files.map(f => f.path)).size !== files.length || files.some(f => !current.files.some(c => c.path === f.path) || /^(<{7}|={7}|>{7}|\|{7})/m.test(f.content)))
      throw new AppError("CONFLICT_CHANGED", "冲突材料已变化或 AI 返回无效文件，未应用建议");
    for (const file of files) {
      if (signal.aborted) throw new AppError("CANCELLED", "已取消冲突处理");
      await writeFile(await this.conflictPath(binding, file.path), file.content, "utf8");
      await this.text(binding.canonicalPath, ["--literal-pathspecs", "add", "--", file.path], signal);
    }
  }
  private async text(
    path: string,
    args: string[],
    signal?: AbortSignal,
  ): Promise<string> {
    return (await runGit(path, args, signal)).stdout.toString("utf8").trim();
  }
  async readCurrentBranch(
    directory: string,
    signal?: AbortSignal,
  ): Promise<RepositoryBranch> {
    if (!isAbsolute(directory))
      throw new AppError("INVALID_DIRECTORY", "分析目录必须为绝对路径", "git");
    const path = await realpath(directory);
    const root = await this.text(
      path,
      ["rev-parse", "--show-toplevel"],
      signal,
    );
    const normalizeCase = (value: string) =>
      process.platform === "win32"
        ? normalize(value).toLowerCase()
        : normalize(value);
    if (normalizeCase(await realpath(root)) !== normalizeCase(path))
      throw new AppError(
        "NOT_REPOSITORY_ROOT",
        "请选择独立 Git 工作树的根目录",
        "git",
      );
    const branchResult = await runGit(
      path,
      ["symbolic-ref", "--quiet", "--short", "HEAD"],
      signal,
      [0, 1],
    );
    return {
      canonicalPath: path,
      branch:
        branchResult.code === 1
          ? null
          : branchResult.stdout.toString("utf8").trim(),
    };
  }
  async inspect(
    binding: RepositoryBinding,
    signal?: AbortSignal,
  ): Promise<RepositoryInspection> {
    const current = await this.readCurrentBranch(binding.canonicalPath, signal);
    const path = current.canonicalPath;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(binding.remoteName))
      throw new AppError("INVALID_REMOTE", "远端名称无效", "git");
    const validBranch = await runGit(
      path,
      ["check-ref-format", "--branch", binding.branch],
      signal,
      [0, 128],
    );
    if (validBranch.code !== 0 || binding.branch.startsWith("-"))
      throw new AppError("INVALID_BRANCH", "分支名称无效", "git");
    const branch = current.branch ?? "";
    const head = await this.text(path, ["rev-parse", "HEAD"], signal);
    const tracking = await runGit(
      path,
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
      signal,
      [0, 128],
    );
    const trackingRef = tracking.stdout.toString().trim();
    await this.assertNoEffectiveFilters(path, signal);
    const status = await this.text(
      path,
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      signal,
    );
    const remote = await this.text(
      path,
      ["remote", "get-url", binding.remoteName],
      signal,
    );
    const remoteUrlFingerprint = hash(remote);
    const blockingReasons: string[] = [];
    if (branch !== binding.branch) blockingReasons.push("BRANCH_MISMATCH");
    if (trackingRef !== `${binding.remoteName}/${binding.branch}`)
      blockingReasons.push("TRACKING_MISSING");
    if (status) blockingReasons.push("WORKTREE_DIRTY");
    if (
      binding.remoteUrlFingerprint &&
      binding.remoteUrlFingerprint !== remoteUrlFingerprint
    )
      blockingReasons.push("REMOTE_CHANGED");
    for (const operation of [
      "MERGE_HEAD",
      "CHERRY_PICK_HEAD",
      "REVERT_HEAD",
      "rebase-merge",
      "rebase-apply",
      "BISECT_LOG",
    ]) {
      const operationPath = await this.text(
        path,
        ["rev-parse", "--git-path", operation],
        signal,
      );
      try {
        await stat(
          isAbsolute(operationPath) ? operationPath : join(path, operationPath),
        );
        blockingReasons.push("GIT_OPERATION_PENDING");
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return {
      bindingId: binding.id,
      branch,
      head,
      trackingRef,
      remoteUrlFingerprint,
      worktreeState: status ? "dirty" : "clean",
      blockingReasons,
    };
  }
  assertReady(inspection: RepositoryInspection): void {
    const code = inspection.blockingReasons[0];
    if (!code) return;
    const messages: Record<string, string> = {
      BRANCH_MISMATCH: "当前分支与配置不一致，请自行切换到配置分支",
      TRACKING_MISSING: "分支未跟踪配置的远端分支，请先设置跟踪关系",
      WORKTREE_DIRTY: "分析目录存在本地修改或未跟踪文件，请先处理",
      REMOTE_CHANGED: "远端仓库地址已改变，请核对项目配置",
      GIT_OPERATION_PENDING: "仓库存在未完成的 Git 操作，请先处理",
    };
    throw new AppError(
      code,
      messages[code] ?? code,
      "git",
      false,
      "处理分析目录后重试；平台不会清理或覆盖本地修改",
    );
  }
  private async tree(
    path: string,
    commit: string,
    signal?: AbortSignal,
  ): Promise<FileEntry[]> {
    const output = (
      await runGit(path, ["ls-tree", "-r", "-z", commit], signal)
    ).stdout.toString("utf8");
    const entries = output
      .split("\0")
      .filter(Boolean)
      .map((line) => {
        const tab = line.indexOf("\t");
        const [mode, , blob] = line.slice(0, tab).split(" ");
        return { path: line.slice(tab + 1), blob, mode };
      });
    if (entries.length > 100000)
      throw new AppError("FILE_LIMIT", "仓库超过首版 100000 个文件上限", "git");
    return entries;
  }
  async synchronize(
    binding: RepositoryBinding,
    signal: AbortSignal,
  ): Promise<RepositorySnapshot> {
    const { inspection, target, all, relation } = await this.fetchTarget(binding, signal);
    if (relation[0] > 0)
      throw new AppError(
        relation[1] > 0 ? "BRANCH_DIVERGED" : "LOCAL_AHEAD",
        relation[1] > 0
          ? "本地与远端已分叉，请自行处理"
          : "本地有尚未推送的提交，不能将其作为远端最新版本分析",
        "git",
      );
    if (relation[1] > 0)
      await this.text(
        binding.canonicalPath,
        ["merge", "--ff-only", "--no-edit", "--no-overwrite-ignore", target],
        signal,
      );
    const after = await this.inspect(binding, signal);
    this.assertReady(after);
    if (after.head !== target)
      throw new AppError(
        "SNAPSHOT_CHANGED",
        "同步后代码版本不一致，请重试",
        "git",
      );
    const files = all.filter(
      (file) =>
        ["100644", "100755"].includes(file.mode) && readablePath(file.path),
    );
    // A private local ref keeps evidence reachable after force pushes and Git GC.
    await this.text(
      binding.canonicalPath,
      ["update-ref", `refs/local-dev-platform/snapshots/${target}`, target],
      signal,
    );
    const includedPaths = new Set(files.map((file) => file.path));
    return {
      bindingId: binding.id,
      canonicalPath: binding.canonicalPath,
      commit: target,
      branch: binding.branch,
      fetchedAt: new Date().toISOString(),
      remoteUrlFingerprint: inspection.remoteUrlFingerprint,
      fileManifestHash: hash(JSON.stringify(files)),
      files,
      excluded: all
        .filter((file) => !includedPaths.has(file.path))
        .map((file) => file.path),
    };
  }
  private async fetchTarget(binding: RepositoryBinding, signal: AbortSignal) {
    const inspection = await this.inspect(binding, signal);
    this.assertReady(inspection);
    const before = await this.tree(
      binding.canonicalPath,
      inspection.head,
      signal,
    );
    await this.validateCheckout(
      binding.canonicalPath,
      inspection.head,
      before,
      signal,
    );
    await this.text(
      binding.canonicalPath,
      [
        "fetch",
        "--no-tags",
        "--no-recurse-submodules",
        binding.remoteName,
        `+refs/heads/${binding.branch}:refs/remotes/${binding.remoteName}/${binding.branch}`,
      ],
      signal,
    );
    const target = await this.text(
      binding.canonicalPath,
      ["rev-parse", `refs/remotes/${binding.remoteName}/${binding.branch}`],
      signal,
    );
    const all = await this.tree(binding.canonicalPath, target, signal);
    await this.validateCheckout(binding.canonicalPath, target, all, signal);
    const relation = (
      await this.text(
        binding.canonicalPath,
        ["rev-list", "--left-right", "--count", `HEAD...${target}`],
        signal,
      )
    )
      .split(/\s+/)
      .map(Number);
    return { inspection, target, all, relation };
  }
  private async assertNoEffectiveFilters(
    path: string,
    signal?: AbortSignal,
  ): Promise<void> {
    // check-attr reads attributes without converting file contents; status can run clean/process drivers.
    const paths = (await runGit(path, ["ls-files", "-z"], signal)).stdout;
    if (paths.length === 0) return;
    const response = (
      await runGit(
        path,
        ["check-attr", "-z", "--stdin", "filter"],
        signal,
        [0],
        { input: paths },
      )
    ).stdout
      .toString("utf8")
      .split("\0");
    const keys = (
      await runGit(
        path,
        [
          "config",
          "--name-only",
          "--get-regexp",
          "^filter\\..*\\.(clean|process)$",
        ],
        signal,
        [0, 1],
      )
    ).stdout.toString("utf8");
    const driverNames = new Set(
      keys
        .split(/\r?\n/)
        .map((key) => key.match(/^filter\.(.*)\.(?:clean|process)$/)?.[1])
        .filter(Boolean),
    );
    for (let index = 0; index + 2 < response.length; index += 3) {
      const value = response[index + 2];
      if (!["unset", "unspecified"].includes(value) || driverNames.has(value))
        throw new AppError(
          "FILTER_UNSUPPORTED",
          "仓库有效属性配置了检出或内容过滤器，检查已在转换文件前停止",
          "git",
        );
    }
  }
  private async validateCheckout(
    path: string,
    commit: string,
    files: FileEntry[],
    signal: AbortSignal,
  ): Promise<void> {
    if (files.some((file) => file.mode === "160000"))
      throw new AppError(
        "SUBMODULE_UNSUPPORTED",
        "检测到子模块，请将需要分析的子仓库作为独立代码目录关联",
        "git",
      );
    for (const entry of files.filter(
      (file) => file.path.split("/").at(-1) === ".gitattributes",
    )) {
      const attributes = await this.text(
        path,
        ["show", `${commit}:${entry.path}`],
        signal,
      );
      if (/\bfilter\s*=/.test(attributes))
        throw new AppError(
          "FILTER_UNSUPPORTED",
          "仓库配置了检出过滤器或 LFS，请先提供可直接读取的分析工作树",
          "git",
        );
    }
  }
  async readFile(
    snapshot: RepositorySnapshot,
    path: string,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    assertReadablePath(path);
    const entry = snapshot.files.find((file) => file.path === path);
    if (!entry || !["100644", "100755"].includes(entry.mode))
      throw new AppError(
        "PATH_DENIED",
        "文件不在此快照的可读清单内",
        "context",
      );
    const size = Number(
      await this.text(
        snapshot.canonicalPath,
        ["cat-file", "-s", entry.blob],
        signal,
      ),
    );
    if (size > 4 * 1024 * 1024)
      throw new AppError(
        "FILE_SIZE_LIMIT",
        "文件超过首版 4 MiB 读取上限",
        "context",
      );
    return (
      await runGit(
        snapshot.canonicalPath,
        ["cat-file", "blob", entry.blob],
        signal,
      )
    ).stdout;
  }
  async listFiles(snapshot: RepositorySnapshot): Promise<FileEntry[]> {
    return snapshot.files.filter((file) => readablePath(file.path));
  }
}
