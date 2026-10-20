import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { IssueAdapter } from "./ports";
import { ScopePolicy, bindingFingerprint, fingerprint } from "./scope-policy";
import type { Project, Task } from "../../../contracts/src/models";
import {
  IssueConnectionDraftSchema,
  type IssueConnection,
  type IssueScope,
  type IssueSnapshot,
  type RemoteIssue,
  type PublicIssueConnection,
  type JiraCatalogue,
  isIssueStatusIndexed,
} from "../../../contracts/src/issues";
import { AppError, errorData } from "../../../contracts/src/error";
import type { IssueWorkspace } from "../../../contracts/src/issue-monitor";
import { issueWebUrl } from "./issue-link";
interface IssueStore {
  getProject(id: string): Project;
  listProjects(): Project[];
  getSetting<T>(key: string): T | null;
  setSetting(key: string, value: unknown): void;
  issues: {
    save(issue: IssueSnapshot): void;
    get(projectId: string, id: string): IssueSnapshot;
    replaceBatch(
      projectId: string,
      bindingId: string,
      scopeHash: string,
      snapshots: IssueSnapshot[],
    ): void;
    batch(
      projectId: string,
      bindingId: string,
      scopeHash: string,
    ): IssueSnapshot[];
  };
}
export class IssueService {
  constructor(
    private readonly store: IssueStore,
    private readonly adapter: (connection: IssueConnection) => IssueAdapter,
  ) {}
  connections(): IssueConnection[] {
    return this.store.getSetting<IssueConnection[]>("issue-connections") ?? [];
  }
  connection(id: string): IssueConnection {
    const c = this.connections().find((c) => c.id === id);
    if (!c)
      throw new AppError(
        "ISSUE_NOT_CONFIGURED",
        "项目关联的 BUG 来源连接已不存在，请编辑项目重新关联来源",
      );
    return c;
  }
  publicConnections(): PublicIssueConnection[] {
    return this.connections().map(({ credentialRef, ...c }) => ({
      ...c,
      hasCredential: Boolean(credentialRef),
    }));
  }
  async catalogue(connectionId: string, signal: AbortSignal): Promise<JiraCatalogue> {
    const connection = this.connection(connectionId);
    const source = this.adapter(connection);
    if (!source.discover) throw new AppError("ISSUE_DISCOVERY_UNAVAILABLE", "此来源不支持 Jira 项目发现");
    const result = await source.discover(connection, signal);
    if (signal.aborted) throw new AppError("CANCELLED", "Jira 项目读取已取消");
    if (fingerprint(connection) !== fingerprint(this.connection(connectionId))) throw new AppError("PROJECT_CHANGED", "Jira 连接已变化，请重新读取项目");
    return result;
  }
  async validateBindings(bindings: Project["issueBindings"], signal: AbortSignal): Promise<void> {
    for (const binding of bindings) {
      if (!binding.connectionId) throw new AppError("ISSUE_NOT_CONFIGURED", "请登录 Jira 并选择项目");
      ScopePolicy.validate({ projectId: "configuration", enabled: true, binding, connection: this.connection(binding.connectionId) });
      if (!binding.issueTypeIds?.length) throw new AppError("ISSUE_NOT_CONFIGURED", "请选择缺陷类型");
      if (binding.platform === "trinity") continue;
      const catalogue = await this.catalogue(binding.connectionId, signal);
      if (binding.owner !== catalogue.owner || !catalogue.projects.some((p) => p.key === binding.projectKey) || !binding.issueTypeIds?.length || binding.issueTypeIds.some((id) => !catalogue.issueTypes.some((t) => t.id === id)))
        throw new AppError("JIRA_SELECTION_INVALID", "Jira 项目、负责人或缺陷类型与当前登录信息不符，请重新读取并选择");
    }
  }
  async validateBindingChanges(previous: Project["issueBindings"], next: Project["issueBindings"], signal: AbortSignal): Promise<void> {
    await this.validateBindings(next.filter(b => !previous.some(old => isDeepStrictEqual(old, b))), signal);
  }
  saveConnection(value: unknown): PublicIssueConnection {
    const input = z
      .object({
        id: z.uuid(),
        credentialRef: z.uuid().nullable(),
        draft: IssueConnectionDraftSchema,
      })
      .strict()
      .parse(value);
    const connection = {
      ...input.draft,
      id: input.id,
      credentialRef: input.credentialRef,
    };
    const previous = this.connections().find(c => c.id === input.id);
    if (previous && (previous.kind !== connection.kind || previous.platform !== connection.platform ||
      previous.baseUrl !== connection.baseUrl ||
      ("username" in previous ? previous.username : undefined) !== ("username" in connection ? connection.username : undefined))) {
      this.assertUnreferenced(input.id);
    }
    this.store.setSetting("issue-connections", [
      ...this.connections().filter((c) => c.id !== input.id),
      connection,
    ]);
    const { credentialRef, ...c } = connection;
    return { ...c, hasCredential: Boolean(credentialRef) };
  }
  deleteConnection(id: string): void {
    this.connection(id);
    this.assertUnreferenced(id);
    this.store.setSetting(
      "issue-connections",
      this.connections().filter((c) => c.id !== id),
    );
  }
  private assertUnreferenced(id: string): void {
    const projects = this.store.listProjects().filter(p => p.issueBindings.some(b => b.connectionId === id));
    if (projects.length) throw new AppError("ISSUE_CONNECTION_IN_USE",
      `连接仍被项目「${projects.map(p => p.name).join("、")}」使用，请先编辑项目解除或更换关联；重新登录请编辑原连接。`);
  }
  scope(projectId: string, bindingId: string): IssueScope {
    const project = this.store.getProject(projectId);
    const binding = project.issueBindings.find((b) => b.id === bindingId);
    if (!binding?.connectionId || !binding.issueTypeIds?.length)
      throw new AppError(
        "ISSUE_NOT_CONFIGURED",
        "请为 BUG 范围关联来源连接并填写类型 ID",
      );
    const scope = {
      projectId,
      enabled: project.enabled,
      binding,
      connection: this.connection(binding.connectionId),
    };
    ScopePolicy.validate(scope);
    return scope;
  }
  workspace(projectId: string): IssueWorkspace {
    const project = this.store.getProject(projectId);
    const issues: IssueWorkspace["issues"] = [];
    const sources = project.issueBindings.map((binding) => {
      const label = `${this.connections().find(c => c.id === binding.connectionId)?.name ?? binding.platform} · ${binding.projectKey} · ${binding.owner}`;
      try {
        const scope = this.scope(projectId, binding.id);
        const batch = this.store.issues.batch(projectId, binding.id, bindingFingerprint(scope))
          .filter(i => isIssueStatusIndexed(scope.connection.platform, i.status));
        const linked = batch.map(issue => ({ ...issue, webUrl: issueWebUrl(scope, issue) }));
        issues.push(...linked);
        return { bindingId: binding.id, label, status: "idle" as const, count: batch.length, lastSuccessAt: null, error: null };
      } catch (error) {
        return { bindingId: binding.id, label, status: "failed" as const, count: 0, lastSuccessAt: null, error: errorData(error) };
      }
    });
    return { issues, sources };
  }
  private snapshot(scope: IssueScope, issue: RemoteIssue): IssueSnapshot {
    ScopePolicy.assert(scope, issue);
    return {
      ...issue,
      schemaVersion: 1,
      id: randomUUID(),
      projectId: scope.projectId,
      bindingId: scope.binding.id,
      connectionId: scope.connection.id,
      scopeHash: bindingFingerprint(scope),
      contentHash: fingerprint(issue),
      fetchedAt: new Date().toISOString(),
    };
  }
  async refresh(
    projectId: string,
    bindingId: string,
    key: string | undefined,
    signal: AbortSignal,
  ): Promise<IssueSnapshot[]> {
    const scope = this.scope(projectId, bindingId);
    const source = this.adapter(scope.connection);
    const records = key
      ? [await source.get(scope, key, signal)]
      : await source.list(scope, signal);
    const snapshots = records.map((r) => this.snapshot(scope, r));
    if (key && snapshots.length) ScopePolicy.assertActiveStatus(scope, snapshots[0].status);
    const indexed = snapshots.filter((issue) => isIssueStatusIndexed(scope.connection.platform, issue.status));
    if (signal.aborted) throw new AppError("CANCELLED", "问题读取已取消");
    this.assertCurrent(scope);
    this.store.issues.replaceBatch(
      projectId,
      bindingId,
      bindingFingerprint(scope),
      key ? [...this.store.issues.batch(projectId, bindingId, bindingFingerprint(scope))
        .filter(previous => !indexed.some(issue => issue.remoteId === previous.remoteId)), ...indexed] : indexed,
    );
    return indexed;
  }
  private assertCurrent(scope: IssueScope): void {
    if (
      bindingFingerprint(this.scope(scope.projectId, scope.binding.id)) !==
      bindingFingerprint(scope)
    )
      throw new AppError(
        "PROJECT_CHANGED",
        "BUG 范围或连接已变化，未保存本次读取",
      );
  }
  async prepare(task: Task, signal: AbortSignal): Promise<string> {
    if (!task.issueSnapshotId)
      throw new AppError("ISSUE_NOT_FOUND", "任务没有问题输入");
    const previous = this.store.issues.get(
      task.projectId,
      task.issueSnapshotId,
    );
    const scope = this.scope(task.projectId, previous.bindingId);
    if (previous.scopeHash !== bindingFingerprint(scope))
      throw new AppError(
        "PROJECT_CHANGED",
        "问题读取时的来源配置已变化，请重新读取",
      );
    const latest = await this.adapter(scope.connection).get(
      scope,
      previous.key,
      signal,
    );
    this.assertCurrent(scope);
    const snapshot = this.snapshot(scope, latest);
    ScopePolicy.assertActiveStatus(scope, snapshot.status);
    this.store.issues.save(snapshot);
    return snapshot.id;
  }
  async validateFresh(
    issue: IssueSnapshot,
    signal: AbortSignal,
  ): Promise<void> {
    const scope = this.scope(issue.projectId, issue.bindingId);
    if (issue.scopeHash !== bindingFingerprint(scope))
      throw new AppError("PROJECT_CHANGED", "BUG 连接或范围发生变化");
    const current = await this.adapter(scope.connection).get(
      scope,
      issue.key,
      signal,
    );
    ScopePolicy.assert(scope, current);
    ScopePolicy.assertActiveStatus(scope, current.status);
    this.assertCurrent(scope);
    if (fingerprint(current) !== issue.contentHash)
      throw new AppError(
        "ISSUE_CHANGED",
        "BUG 内容或归属已变化，请重新分析最新输入",
      );
  }
}
