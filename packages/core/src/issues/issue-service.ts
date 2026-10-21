import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { IssueAdapter } from "./ports";
import { ScopePolicy, bindingFingerprint, fingerprint, instanceUrl } from "./scope-policy";
import type { Project, Task } from "../../../contracts/src/models";
import {
  IssueConnectionDraftSchema,
  RemoteIssueSchema,
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
import { trinityAccountBinding } from "./bindings";
import { issueWebUrl } from "./issue-link";
interface IssueStore {
  getProject(id: string): Project;
  listProjects(): Project[];
  getSetting<T>(key: string): T | null;
  setSetting(key: string, value: unknown): void;
  issues: {
    save(issue: IssueSnapshot): void;
    get(projectId: string, id: string): IssueSnapshot;
    replaceBatches(batches: {projectId:string;bindingId:string;scopeHash:string;snapshots:IssueSnapshot[]}[]): void;
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
  private readonly accountReads = new Map<string, { key: string | undefined; promise: Promise<IssueSnapshot[]> }>();
  constructor(
    private readonly store: IssueStore,
    readonly adapter: (connection: IssueConnection) => IssueAdapter,
    private readonly onRead?: (scope:IssueScope,issues:IssueSnapshot[])=>Promise<void>,
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
  async trinityProjects(connectionId: string, signal: AbortSignal): Promise<NonNullable<Project["trinityProjects"]>> {
    const connection=this.connection(connectionId);
    if(connection.kind!=="trinity")throw new AppError("ISSUE_DISCOVERY_UNAVAILABLE","此入口仅支持 Trinity 项目");
    const scope:IssueScope={projectId:"trinity-catalogue",enabled:true,connection,binding:trinityAccountBinding(connection)};
    ScopePolicy.validate(scope);
    const records=await this.adapter(connection).list(scope,signal);
    if(signal.aborted)throw new AppError("CANCELLED","Trinity 项目读取已取消");
    if(fingerprint(connection)!==fingerprint(this.connection(connectionId)))throw new AppError("PROJECT_CHANGED","Trinity 账号已变化，请重新读取项目");
    const projects=new Map<string,NonNullable<Project["trinityProjects"]>[number]>();
    for(const issue of records){
      ScopePolicy.assert(scope,issue);
      const previous=projects.get(issue.remoteProjectId);
      projects.set(issue.remoteProjectId,{instanceUrl:instanceUrl(connection.baseUrl),projectId:issue.remoteProjectId,...(issue.remoteProjectName?{name:issue.remoteProjectName}:previous?.name?{name:previous.name}:{})});
    }
    return [...projects.values()].sort((a,b)=>(a.name??a.projectId).localeCompare(b.name??b.projectId)||a.projectId.localeCompare(b.projectId));
  }
  async mappingForIssue(projectId: string, issueSnapshotId: string, signal: AbortSignal): Promise<NonNullable<Project["trinityProjects"]>[number]> {
    const issue=this.store.issues.get(projectId,issueSnapshotId);
    const scope=this.scope(projectId,issue.bindingId);
    if(scope.connection.kind!=="trinity"||scope.binding.scopeMode!=="account")throw new AppError("ISSUE_OUT_OF_SCOPE","只能关联当前 Trinity 账号的问题项目");
    if(issue.scopeHash!==bindingFingerprint(scope))throw new AppError("PROJECT_CHANGED","Trinity 来源或账号已变化，请刷新问题列表");
    ScopePolicy.assert(scope,issue);
    const latest=await this.adapter(scope.connection).get(scope,issue.key,signal);
    if(signal.aborted)throw new AppError("CANCELLED","Trinity 项目关联已取消");
    this.assertCurrent(scope);ScopePolicy.assert(scope,latest);
    if(latest.remoteProjectId!==issue.remoteProjectId)throw new AppError("ISSUE_CHANGED","问题所属 Trinity 项目已变化，请刷新后重新关联");
    return {instanceUrl:instanceUrl(latest.instanceUrl),projectId:latest.remoteProjectId,...(latest.remoteProjectName?{name:latest.remoteProjectName}:{})};
  }
  async validateBindings(bindings: Project["issueBindings"], signal: AbortSignal): Promise<void> {
    for (const binding of bindings) {
      if (!binding.connectionId) throw new AppError("ISSUE_NOT_CONFIGURED", "请登录 Jira 并选择项目");
      ScopePolicy.validate({ projectId: "configuration", enabled: true, binding, connection: this.connection(binding.connectionId) });
      if (!binding.issueTypeIds?.length) throw new AppError("ISSUE_NOT_CONFIGURED", "请选择缺陷类型");
      if (binding.platform === "trinity") continue;
      const saved = this.connection(binding.connectionId);
      if (saved.kind !== "trinity" && saved.jiraProject) {
        const selected = saved.jiraProject;
        if (binding.projectKey !== selected.key || binding.owner !== selected.owner || !isDeepStrictEqual(binding.issueTypeIds, selected.issueTypeIds)) throw new AppError("JIRA_SELECTION_INVALID", "Jira 范围必须使用连接已保存的项目配置");
        continue;
      }
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
    if (previous && (previous.kind !== connection.kind || previous.platform !== connection.platform)) this.assertUnreferenced(input.id);
    if (previous && connection.kind !== "trinity" && (previous.kind !== connection.kind || previous.platform !== connection.platform ||
      previous.baseUrl !== connection.baseUrl ||
      ("username" in previous ? previous.username : undefined) !== ("username" in connection ? connection.username : undefined))) {
      this.assertUnreferenced(input.id);
    }
    if (connection.kind === "trinity" && this.connections().some(c => c.kind === "trinity" && c.id !== connection.id)) throw new AppError("TRINITY_ACCOUNT_UNIQUE", "请编辑已有 Trinity 账号，不能添加第二个账号");
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
      const label = `${this.connections().find(c => c.id === binding.connectionId)?.name ?? binding.platform} · ${binding.scopeMode === "account" ? "账号问题" : binding.projectKey} · ${binding.owner}`;
      try {
        const scope = this.scope(projectId, binding.id);
        const batch = this.store.issues.batch(projectId, binding.id, bindingFingerprint(scope))
          .filter(i => isIssueStatusIndexed(scope.connection.platform, i.status));
        const linked = batch.map(issue => ({ ...issue, webUrl: issueWebUrl(scope, issue), ...this.analysisTarget(projectId, issue) }));
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
  async refresh(projectId: string, bindingId: string, key: string | undefined, signal: AbortSignal): Promise<IssueSnapshot[]> {
    const scope=this.scope(projectId,bindingId);
    if(scope.binding.scopeMode!=="account")return this.refreshSource(projectId,bindingId,key,signal);
    const hash=bindingFingerprint(scope);
    const previous=this.accountReads.get(hash);
    if(previous){
      await previous.promise;
      if(signal.aborted)throw new AppError("CANCELLED","账号问题读取已取消");
      this.assertCurrent(scope);
      if(previous.key!==key)return this.refresh(projectId,bindingId,key,signal);
      return this.store.issues.batch(projectId,bindingId,hash).filter(issue=>!key||issue.key===key);
    }
    const promise=this.refreshSource(projectId,bindingId,key,signal).finally(()=>this.accountReads.delete(hash));
    this.accountReads.set(hash,{key,promise});
    return promise;
  }
  private async refreshSource(
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
    const scopes = scope.binding.scopeMode === "account" ? this.store.listProjects().filter(p=>p.enabled&&p.issueBindings.some(b=>b.id===bindingId)).map(p=>this.scope(p.id,bindingId)) : [scope];
    const batches=scopes.map(target=>{
      if(bindingFingerprint(target)!==bindingFingerprint(scope))throw new AppError("PROJECT_CHANGED","Trinity 账号配置已变化，未发布本次列表");
      const next=target.projectId===projectId?indexed:indexed.map(issue=>this.snapshot(target,RemoteIssueSchema.strip().parse(issue)));
      return {projectId:target.projectId,bindingId,scopeHash:bindingFingerprint(target),snapshots:key?[...this.store.issues.batch(target.projectId,bindingId,bindingFingerprint(target)).filter(previous=>!next.some(issue=>issue.remoteId===previous.remoteId)),...next]:next};
    });
    this.store.issues.replaceBatches(batches);
    await this.onRead?.(scope,indexed);
    return indexed;
  }
  assertCurrent(scope: IssueScope): void {
    if (
      bindingFingerprint(this.scope(scope.projectId, scope.binding.id)) !==
      bindingFingerprint(scope)
    )
      throw new AppError(
        "PROJECT_CHANGED",
        "BUG 范围或连接已变化，未保存本次读取",
      );
  }
  analysisTarget(projectId: string, issue: RemoteIssue): { analysisProjectId?: string; analysisProjectName?: string; analysisUnavailable: string; analysisProjects?: {id:string;name:string}[] } {
    const current = this.store.getProject(projectId);
    const accountIssue = current.issueBindings.some(b => b.platform === "trinity" && b.scopeMode === "account" && b.instanceUrl === issue.instanceUrl);
    if (!accountIssue) return {analysisProjectId:projectId,analysisProjectName:current.name,analysisUnavailable:""};
    const candidates = this.store.listProjects().filter(p => p.enabled && p.trinityProjects?.some(m => m.projectId === issue.remoteProjectId && new URL(m.instanceUrl).href.replace(/\/$/, "") === new URL(issue.instanceUrl).href.replace(/\/$/, "")));
    const target = candidates.find(p => p.id === projectId) ?? (candidates.length === 1 ? candidates[0] : undefined);
    const analysisProjects=candidates.map(p=>({id:p.id,name:p.name}));
    if (!target) return {analysisProjects,analysisUnavailable:candidates.length ? "当前问题匹配多个代码项目，请选择预分析代码项目" : "当前问题与所有项目不匹配，无法进行预分析，请在代码项目配置 Trinity 项目映射"};
    return {analysisProjects,analysisProjectId:target.id,analysisProjectName:target.name,analysisUnavailable:""};
  }
  assertAnalysisProject(projectId: string, issue: RemoteIssue): void {
    const match = this.analysisTarget(projectId, issue);
    if (match.analysisProjectId !== projectId) throw new AppError("ISSUE_PROJECT_UNMATCHED", match.analysisUnavailable || "当前问题与当前代码项目不匹配，请选择匹配项目重新预分析");
  }
  analysisInput(projectId: string, issueSnapshotId: string, targetProjectId?: string): { projectId: string; issueSnapshotId: string } {
    const issue = this.store.issues.get(projectId, issueSnapshotId);
    const scope = this.scope(projectId, issue.bindingId);
    if (issue.scopeHash !== bindingFingerprint(scope)) throw new AppError("PROJECT_CHANGED", "BUG 来源或账号已变化，请刷新问题列表");
    ScopePolicy.assert(scope, issue); ScopePolicy.assertActiveStatus(scope, issue.status);
    const match = this.analysisTarget(projectId, issue);
    if(targetProjectId){
      if(targetProjectId!==match.analysisProjectId&&!match.analysisProjects?.some(p=>p.id===targetProjectId))throw new AppError("ISSUE_PROJECT_UNMATCHED","所选代码项目未关联此 Trinity 项目，请重新选择");
      match.analysisProjectId=targetProjectId;
    }
    if (!match.analysisProjectId) throw new AppError("ISSUE_PROJECT_UNMATCHED", match.analysisUnavailable);
    if (match.analysisProjectId === projectId) return {projectId,issueSnapshotId};
    const targetScope = this.scope(match.analysisProjectId, issue.bindingId);
    this.assertAnalysisProject(match.analysisProjectId, issue);
    const remote = RemoteIssueSchema.strip().parse(issue);
    const target = this.snapshot(targetScope, remote);
    this.store.issues.save(target);
    return {projectId:match.analysisProjectId,issueSnapshotId:target.id};
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
    this.assertAnalysisProject(task.projectId, latest);
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
    this.assertAnalysisProject(issue.projectId, current);
    ScopePolicy.assertActiveStatus(scope, current.status);
    this.assertCurrent(scope);
    if (fingerprint(current) !== issue.contentHash)
      throw new AppError(
        "ISSUE_CHANGED",
        "BUG 内容或归属已变化，请重新分析最新输入",
      );
  }
}
