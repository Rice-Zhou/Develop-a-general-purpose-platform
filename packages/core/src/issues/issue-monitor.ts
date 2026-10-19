import { randomUUID } from "node:crypto";
import { AppError, errorData } from "../../../contracts/src/error";
import type { ErrorData, Project } from "../../../contracts/src/models";
import {
  DEFAULT_ISSUE_MONITOR_CONFIGURATION, IssueMonitorConfigurationSchema,
  type IssueMonitorConfiguration, type IssueMonitorStatus, type IssueNotification,
  type IssueNotifier, type IssueSourceState, type NotificationRecipient, type IssueWorkspace,
} from "../../../contracts/src/issue-monitor";
import type { IssueSnapshot } from "../../../contracts/src/issues";
import { ISSUE_REFRESH_TIMEOUT_MS } from "../../../contracts/src/issues";
import { IssueService } from "./issue-service";
import { bindingFingerprint } from "./scope-policy";
import { issueWebUrl } from "./issue-link";

interface Cursor {
  scopeHash: string;
  known: string[] | null;
  lastAttemptAt: number;
  source: IssueSourceState;
}
interface MonitorState {
  configuration: IssueMonitorConfiguration;
  cursors: Record<string, Cursor>;
  pending: IssueNotification[];
  recipient: NotificationRecipient | null;
  notificationError: ErrorData | null;
  lastNotificationAt: string | null;
}
interface MonitorStore {
  listProjects(): Project[];
  getProject(id: string): Project;
  getSetting<T>(key: string): T | null;
  setSetting(key: string, value: unknown): void;
}
const STATE_KEY = "issue-monitor-state";
const cursorKey = (projectId: string, bindingId: string) => `${projectId}:${bindingId}`;

export class IssueMonitor {
  private readonly state: MonitorState;
  private readonly running = new Map<string, Promise<IssueWorkspace>>();
  private readonly controller = new AbortController();
  private timer: NodeJS.Timeout | undefined;
  private runtimeError: ErrorData | null = null;
  private ticking = false;
  constructor(
    private readonly store: MonitorStore,
    private readonly issues: IssueService,
    private readonly notifier: IssueNotifier,
    private readonly now: () => number = Date.now,
  ) {
    this.state = store.getSetting<MonitorState>(STATE_KEY) ?? {
      configuration: { ...DEFAULT_ISSUE_MONITOR_CONFIGURATION }, cursors: {}, pending: [],
      recipient: null, notificationError: null, lastNotificationAt: null,
    };
  }
  private save() { this.store.setSetting(STATE_KEY, this.state); }
  status(): IssueMonitorStatus {
    return {
      configuration: { ...this.state.configuration }, recipient: this.state.recipient,
      pendingCount: this.state.pending.length, notificationError: this.state.notificationError,
      lastNotificationAt: this.state.lastNotificationAt, runtimeError: this.runtimeError,
      running: this.running.size > 0,
    };
  }
  configure(value: unknown): IssueMonitorStatus {
    this.state.configuration = IssueMonitorConfigurationSchema.parse(value);
    this.save();
    return this.status();
  }
  async checkNotification(signal = this.controller.signal): Promise<IssueMonitorStatus> {
    try {
      const recipient = await this.notifier.self(signal);
      if (this.state.recipient && this.state.recipient.openId !== recipient.openId)
        throw new AppError("FEISHU_IDENTITY_CHANGED", "飞书 CLI 登录用户已变化，请恢复原通知接收账号后重试");
      this.state.recipient = recipient;
      this.state.notificationError = null;
      this.save();
      return this.status();
    } catch (error) {
      this.state.notificationError = errorData(error);
      this.save();
      throw error;
    }
  }
  workspace(projectId: string): IssueWorkspace {
    const workspace = this.issues.workspace(projectId);
    return { ...workspace, sources: workspace.sources.map(source => {
      if (source.error) return source;
      const scopeHash = bindingFingerprint(this.issues.scope(projectId, source.bindingId));
      const cursor = this.state.cursors[cursorKey(projectId, source.bindingId)];
      return cursor?.scopeHash === scopeHash ? { ...cursor.source, label: source.label, count: source.count } : source;
    }) };
  }
  refreshProject(projectId: string): Promise<IssueWorkspace> {
    const existing = this.running.get(projectId);
    if (existing) return existing;
    if (this.controller.signal.aborted) return Promise.reject(new AppError("CANCELLED", "问题监控正在停止"));
    const work = this.refresh(projectId).finally(() => this.running.delete(projectId));
    this.running.set(projectId, work);
    return work;
  }
  private async refresh(projectId: string): Promise<IssueWorkspace> {
    const project = this.store.getProject(projectId);
    if (!project.enabled) throw new AppError("PROJECT_DISABLED", "项目已停用");
    const successful = new Set<string>();
    const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(ISSUE_REFRESH_TIMEOUT_MS)]);
    const read = async (binding: Project["issueBindings"][number]) => {
      const key = cursorKey(projectId, binding.id);
      let scopeHash = "";
      try {
        if (signal.aborted) throw new AppError("CANCELLED", "问题刷新已取消或超时");
        scopeHash = bindingFingerprint(this.issues.scope(projectId, binding.id));
        const snapshots = await this.issues.refresh(projectId, binding.id, undefined, signal);
        if (bindingFingerprint(this.issues.scope(projectId, binding.id)) !== scopeHash)
          throw new AppError("PROJECT_CHANGED", "问题范围已变化，请重新刷新");
        this.observe(project, binding.id, scopeHash, snapshots);
        successful.add(scopeHash);
      } catch (error) {
        const previous = this.state.cursors[key];
        this.state.cursors[key] = {
          scopeHash, known: previous?.scopeHash === scopeHash ? previous.known : null,
          lastAttemptAt: this.now(), source: {
            bindingId: binding.id, label: `${binding.platform} · ${binding.projectKey} · ${binding.owner}`,
            status: "failed", count: previous?.source.count ?? 0,
            lastSuccessAt: previous?.scopeHash === scopeHash ? previous.source.lastSuccessAt : null,
            error: errorData(error),
          },
        };
        this.save();
      }
    };
    for (let offset = 0; offset < project.issueBindings.length; offset += 2) {
      await Promise.all(project.issueBindings.slice(offset, offset + 2).map(read));
      if (this.controller.signal.aborted) break;
    }
    this.prune();
    await this.flush(successful);
    return this.workspace(projectId);
  }
  private observe(project: Project, bindingId: string, scopeHash: string, snapshots: IssueSnapshot[]) {
    const key = cursorKey(project.id, bindingId);
    const previous = this.state.cursors[key];
    const known = previous?.scopeHash === scopeHash ? previous.known : null;
    if (known && this.state.configuration.enabled && this.state.configuration.notificationsEnabled) {
      const scope = this.issues.scope(project.id, bindingId);
      for (const issue of snapshots.filter(i => !known.includes(i.remoteId))) {
        this.state.pending.push({
          id: randomUUID(), projectId: project.id, bindingId, scopeHash,
          remoteId: issue.remoteId, key: issue.key,
          text: `有新的 BUG 需要及时处理\n项目：${project.name}\n${issue.key} · ${issue.title.slice(0, 300)}\n${issueWebUrl(scope, issue)}`,
        });
      }
    }
    this.state.cursors[key] = {
      scopeHash, known: snapshots.map(i => i.remoteId), lastAttemptAt: this.now(),
      source: { bindingId, label: `${project.issueBindings.find(b => b.id === bindingId)!.projectKey}`,
        status: "success", count: snapshots.length, lastSuccessAt: new Date(this.now()).toISOString(), error: null },
    };
    // Persist the new observation and outbox together before attempting delivery.
    this.save();
  }
  private current(event: IssueNotification): boolean {
    const project = this.store.listProjects().find(p => p.id === event.projectId && p.enabled);
    if (!project?.issueBindings.some(b => b.id === event.bindingId)) return false;
    try { return bindingFingerprint(this.issues.scope(project.id, event.bindingId)) === event.scopeHash; }
    catch { return false; } // The workspace exposes the configuration error; never send for an invalid scope.
  }
  private prune() {
    this.state.pending = this.state.pending.filter(event => this.current(event));
    const projects = this.store.listProjects();
    for (const key of Object.keys(this.state.cursors)) {
      if (!projects.some(p => p.enabled && p.issueBindings.some(b => cursorKey(p.id, b.id) === key)))
        delete this.state.cursors[key];
    }
    this.save();
  }
  private async flush(successful: Set<string>) {
    if (!this.state.configuration.enabled || !this.state.configuration.notificationsEnabled || this.controller.signal.aborted) return;
    const events = this.state.pending.filter(e => successful.has(e.scopeHash));
    if (!events.length) return;
    try {
      const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(30000)]);
      await this.checkNotification(signal);
      for (const event of events) {
        if (!this.state.configuration.enabled || !this.state.configuration.notificationsEnabled || this.controller.signal.aborted) return;
        const stillVisible = this.current(event) && this.issues.workspace(event.projectId).issues
          .some(i => i.bindingId === event.bindingId && i.remoteId === event.remoteId);
        if (stillVisible) {
          await this.notifier.send(event, this.state.recipient!, signal, () => {
            if (!this.current(event) || !this.state.configuration.enabled || !this.state.configuration.notificationsEnabled)
              throw new AppError("ISSUE_NOTIFICATION_STALE", "项目或通知设置已变化，本次未发送");
          });
          this.state.lastNotificationAt = new Date(this.now()).toISOString();
        }
        this.state.pending = this.state.pending.filter(e => e.id !== event.id);
        this.state.notificationError = null;
        this.save();
      }
    } catch (error) {
      this.state.notificationError = errorData(error);
      this.save();
    }
  }
  async tick(): Promise<void> {
    if (this.ticking || this.controller.signal.aborted) return;
    this.ticking = true;
    try {
      this.prune();
      if (!this.state.configuration.enabled) return;
      const interval = this.state.configuration.intervalMinutes * 60000;
      for (const project of this.store.listProjects().filter(p => p.enabled)) {
        const due = project.issueBindings.some(b => {
          const cursor = this.state.cursors[cursorKey(project.id, b.id)];
          if (!cursor) return true;
          try {
            if (bindingFingerprint(this.issues.scope(project.id, b.id)) !== cursor.scopeHash) return true;
          } catch { /* Invalid bindings retain their visible error and retry at the normal interval. */ }
          return this.now() - cursor.lastAttemptAt >= interval;
        });
        if (due) await this.refreshProject(project.id);
      }
      this.runtimeError = null;
    } finally { this.ticking = false; }
  }
  start() {
    if (this.timer) return;
    const poll = () => { void this.tick().catch(error => { this.runtimeError = errorData(error); }); };
    this.timer = setInterval(poll, 15000);
    this.timer.unref();
    poll();
  }
  async shutdown() {
    clearInterval(this.timer);
    this.timer = undefined;
    this.controller.abort();
    await Promise.allSettled([...this.running.values()]);
  }
}
