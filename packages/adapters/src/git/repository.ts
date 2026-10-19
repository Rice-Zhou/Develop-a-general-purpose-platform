import { createHash } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { AppError } from '../../../contracts/src/error';
import type { FileEntry, RepositoryBinding, RepositoryInspection, RepositorySnapshot } from '../../../contracts/src/models';
import { assertReadablePath, readablePath } from '../../../core/src/context/access-policy';
import { runGit } from './git-process';
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
export class GitRepositoryAdapter {
  private async text(path: string, args: string[], signal?: AbortSignal): Promise<string> { return (await runGit(path, args, signal)).stdout.toString('utf8').trim(); }
  async inspect(binding: RepositoryBinding, signal?: AbortSignal): Promise<RepositoryInspection> {
    const path = await realpath(binding.canonicalPath);
    const root = await this.text(path, ['rev-parse', '--show-toplevel'], signal);
    const normalizeCase = (value: string) => process.platform === 'win32' ? normalize(value).toLowerCase() : normalize(value);
    if (normalizeCase(await realpath(root)) !== normalizeCase(path)) throw new AppError('NOT_REPOSITORY_ROOT', '请选择独立 Git 工作树的根目录', 'git');
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(binding.remoteName)) throw new AppError('INVALID_REMOTE', '远端名称无效', 'git');
    const validBranch = await runGit(path, ['check-ref-format', '--branch', binding.branch], signal, [0, 128]);
    if (validBranch.code !== 0 || binding.branch.startsWith('-')) throw new AppError('INVALID_BRANCH', '分支名称无效', 'git');
    const branchResult = await runGit(path, ['symbolic-ref', '--quiet', '--short', 'HEAD'], signal, [0, 1]);
    const branch = branchResult.stdout.toString().trim();
    const head = await this.text(path, ['rev-parse', 'HEAD'], signal);
    const tracking = await runGit(path, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], signal, [0, 128]);
    const trackingRef = tracking.stdout.toString().trim();
    const status = await this.text(path, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], signal);
    const remote = await this.text(path, ['remote', 'get-url', binding.remoteName], signal);
    const remoteUrlFingerprint = hash(remote);
    const blockingReasons: string[] = [];
    if (branch !== binding.branch) blockingReasons.push('BRANCH_MISMATCH');
    if (trackingRef !== `${binding.remoteName}/${binding.branch}`) blockingReasons.push('TRACKING_MISSING');
    if (status) blockingReasons.push('WORKTREE_DIRTY');
    if (binding.remoteUrlFingerprint && binding.remoteUrlFingerprint !== remoteUrlFingerprint) blockingReasons.push('REMOTE_CHANGED');
    for (const operation of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'BISECT_LOG']) {
      const operationPath = await this.text(path, ['rev-parse', '--git-path', operation], signal);
      try { await stat(join(path, operationPath)); blockingReasons.push('GIT_OPERATION_PENDING'); break; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    return { bindingId: binding.id, branch, head, trackingRef, remoteUrlFingerprint, worktreeState: status ? 'dirty' : 'clean', blockingReasons };
  }
  assertReady(inspection: RepositoryInspection): void {
    const code = inspection.blockingReasons[0];
    if (!code) return;
    const messages: Record<string, string> = { BRANCH_MISMATCH: '当前分支与配置不一致，请自行切换到配置分支', TRACKING_MISSING: '分支未跟踪配置的远端分支，请先设置跟踪关系', WORKTREE_DIRTY: '分析目录存在本地修改或未跟踪文件，请先处理', REMOTE_CHANGED: '远端仓库地址已改变，请核对项目配置', GIT_OPERATION_PENDING: '仓库存在未完成的 Git 操作，请先处理' };
    throw new AppError(code, messages[code] ?? code, 'git', false, '处理分析目录后重试；平台不会清理或覆盖本地修改');
  }
  private async tree(path: string, commit: string, signal?: AbortSignal): Promise<FileEntry[]> {
    const output = (await runGit(path, ['ls-tree', '-r', '-z', commit], signal)).stdout.toString('utf8');
    const entries = output.split('\0').filter(Boolean).map(line => {
      const tab = line.indexOf('\t'); const [mode, , blob] = line.slice(0, tab).split(' ');
      return { path: line.slice(tab + 1), blob, mode };
    });
    if (entries.length > 100000) throw new AppError('FILE_LIMIT', '仓库超过首版 100000 个文件上限', 'git');
    return entries;
  }
  async synchronize(binding: RepositoryBinding, signal: AbortSignal): Promise<RepositorySnapshot> {
    const inspection = await this.inspect(binding, signal); this.assertReady(inspection);
    const before = await this.tree(binding.canonicalPath, inspection.head, signal);
    await this.validateCheckout(binding.canonicalPath, inspection.head, before, signal);
    await this.text(binding.canonicalPath, ['fetch', '--no-tags', '--no-recurse-submodules', binding.remoteName, `+refs/heads/${binding.branch}:refs/remotes/${binding.remoteName}/${binding.branch}`], signal);
    const target = await this.text(binding.canonicalPath, ['rev-parse', `refs/remotes/${binding.remoteName}/${binding.branch}`], signal);
    const all = await this.tree(binding.canonicalPath, target, signal);
    await this.validateCheckout(binding.canonicalPath, target, all, signal);
    const relation = (await this.text(binding.canonicalPath, ['rev-list', '--left-right', '--count', `HEAD...${target}`], signal)).split(/\s+/).map(Number);
    if (relation[0] > 0) throw new AppError(relation[1] > 0 ? 'BRANCH_DIVERGED' : 'LOCAL_AHEAD', relation[1] > 0 ? '本地与远端已分叉，请自行处理' : '本地有尚未推送的提交，不能将其作为远端最新版本分析', 'git');
    if (relation[1] > 0) await this.text(binding.canonicalPath, ['merge', '--ff-only', '--no-edit', target], signal);
    const after = await this.inspect(binding, signal); this.assertReady(after);
    if (after.head !== target) throw new AppError('SNAPSHOT_CHANGED', '同步后代码版本不一致，请重试', 'git');
    const files = all.filter(file => ['100644', '100755'].includes(file.mode) && readablePath(file.path));
    return { bindingId: binding.id, canonicalPath: binding.canonicalPath, commit: target, branch: binding.branch, fetchedAt: new Date().toISOString(), remoteUrlFingerprint: inspection.remoteUrlFingerprint, fileManifestHash: hash(JSON.stringify(files)), files, excluded: all.filter(file => !files.includes(file)).map(file => file.path) };
  }
  private async validateCheckout(path: string, commit: string, files: FileEntry[], signal: AbortSignal): Promise<void> {
    if (files.some(file => file.mode === '160000')) throw new AppError('SUBMODULE_UNSUPPORTED', '检测到子模块，请将需要分析的子仓库作为独立代码目录关联', 'git');
    for (const entry of files.filter(file => file.path.split('/').at(-1) === '.gitattributes')) {
      const attributes = await this.text(path, ['show', `${commit}:${entry.path}`], signal);
      if (/\bfilter\s*=/.test(attributes)) throw new AppError('FILTER_UNSUPPORTED', '仓库配置了检出过滤器或 LFS，请先提供可直接读取的分析工作树', 'git');
    }
  }
  async readFile(snapshot: RepositorySnapshot, path: string): Promise<Buffer> {
    assertReadablePath(path);
    const entry = snapshot.files.find(file => file.path === path);
    if (!entry || !['100644', '100755'].includes(entry.mode)) throw new AppError('PATH_DENIED', '文件不在此快照的可读清单内', 'context');
    const size = Number(await this.text(snapshot.canonicalPath, ['cat-file', '-s', entry.blob]));
    if (size > 4 * 1024 * 1024) throw new AppError('FILE_SIZE_LIMIT', '文件超过首版 4 MiB 读取上限', 'context');
    return (await runGit(snapshot.canonicalPath, ['cat-file', 'blob', entry.blob])).stdout;
  }
  async listFiles(snapshot: RepositorySnapshot): Promise<FileEntry[]> { return snapshot.files.filter(file => readablePath(file.path)); }
}
