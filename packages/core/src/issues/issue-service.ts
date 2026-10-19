import { randomUUID } from "node:crypto";
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
} from "../../../contracts/src/issues";
import { AppError } from "../../../contracts/src/error";
interface IssueStore {
  getProject(id: string): Project;
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
        "BUG 来源连接不存在，请在设置配置并关联项目",
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
    for (const binding of bindings.filter((b) => b.platform !== "trinity")) {
      if (!binding.connectionId) throw new AppError("ISSUE_NOT_CONFIGURED", "请登录 Jira 并选择项目");
      const catalogue = await this.catalogue(binding.connectionId, signal);
      ScopePolicy.validate({ projectId: "configuration", enabled: true, binding, connection: this.connection(binding.connectionId) });
      if (binding.owner !== catalogue.owner || !catalogue.projects.some((p) => p.key === binding.projectKey) || !binding.issueTypeIds?.length || binding.issueTypeIds.some((id) => !catalogue.issueTypes.some((t) => t.id === id)))
        throw new AppError("JIRA_SELECTION_INVALID", "Jira 项目、负责人或缺陷类型与当前登录信息不符，请重新读取并选择");
    }
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
    this.store.setSetting("issue-connections", [
      ...this.connections().filter((c) => c.id !== input.id),
      connection,
    ]);
    const { credentialRef, ...c } = connection;
    return { ...c, hasCredential: Boolean(credentialRef) };
  }
  deleteConnection(id: string): void {
    this.connection(id);
    this.store.setSetting(
      "issue-connections",
      this.connections().filter((c) => c.id !== id),
    );
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
  visible(projectId: string): IssueSnapshot[] {
    const p = this.store.getProject(projectId);
    return p.issueBindings.flatMap((b) => {
      if (
        !b.connectionId ||
        !b.issueTypeIds?.length ||
        !this.connections().some((c) => c.id === b.connectionId)
      )
        return [];
      const scope = this.scope(projectId, b.id);
      return this.store.issues.batch(
        projectId,
        b.id,
        bindingFingerprint(scope),
      );
    });
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
    if (signal.aborted) throw new AppError("CANCELLED", "问题读取已取消");
    this.assertCurrent(scope);
    this.store.issues.replaceBatch(
      projectId,
      bindingId,
      bindingFingerprint(scope),
      snapshots,
    );
    return snapshots;
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
    this.assertCurrent(scope);
    if (fingerprint(current) !== issue.contentHash)
      throw new AppError(
        "ISSUE_CHANGED",
        "BUG 内容或归属已变化，请重新分析最新输入",
      );
  }
}
