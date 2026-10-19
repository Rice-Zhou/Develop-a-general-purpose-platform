import { z } from "zod";
import { AppError } from "../../../contracts/src/error";
import {
  RemoteIssueSchema,
  type IssueScope,
  type RemoteIssue,
} from "../../../contracts/src/issues";
import {
  ScopePolicy,
  instanceUrl,
} from "../../../core/src/issues/scope-policy";
import type { IssueAdapter } from "../../../core/src/issues/ports";
import { readResponseText } from "../network/response";
import { curlFetch } from "../network/curl-fetch";
const id = z.union([z.string(), z.number()]).transform(String);
const response = z.object({
  code: z.literal(200),
  data: z.object({
    id,
    bugId: z.string(),
    projectId: id,
    assigneeId: id,
    title: z.string(),
    description: z.string().nullable(),
    status: z.union([z.string(), z.number()]).transform(String),
    updateTime: z.string(),
    workitemId: id.optional(),
  }),
});
export class TrinityAdapter implements IssueAdapter {
  private protocol: Promise<{ apiVersion: string; isGray: boolean }> | undefined;
  constructor(
    private readonly resolveToken: () => Promise<string>,
    private readonly request: typeof fetch = curlFetch as typeof fetch,
  ) {}
  async list(scope: IssueScope, signal: AbortSignal): Promise<RemoteIssue[]> {
    ScopePolicy.validate(scope);
    const issues: RemoteIssue[] = [];
    const seen = new Set<string>();
    let total: number | undefined;
    for (let pageNum = 1; pageNum <= 100; pageNum++) {
      const raw = await this.read(scope, "/quality/quality/bug/findBugsByProject", signal, {
        projectId: scope.binding.projectKey,
        projectIds: [scope.binding.projectKey],
        assignees: [scope.binding.owner],
        pageNum,
        pageSize: 100,
      });
      const parsed = z.object({ success: z.literal(true), data: z.object({
        pageNum: z.number().int().positive(), total: z.number().int().nonnegative().max(10000),
        bugs: z.array(z.object({ bugId: z.string().min(1).max(200) })).max(100),
      }) }).safeParse(raw);
      if (!parsed.success) throw new AppError("ISSUE_REMOTE_FAILED", "Trinity 项目列表响应契约不符或登录已失效，请检查连接");
      const page = parsed.data.data;
      if (page.pageNum !== pageNum || (total !== undefined && total !== page.total))
        throw new AppError("ISSUE_PAGINATION_INVALID", "Trinity 分页或总数已变化，请重新刷新，未发布部分列表");
      total = page.total;
      for (const row of page.bugs) {
        if (seen.has(row.bugId)) throw new AppError("ISSUE_PAGINATION_INVALID", "Trinity 分页返回重复问题，未发布部分列表");
        seen.add(row.bugId);
        issues.push(await this.get(scope, row.bugId, signal));
      }
      if (issues.length === total) return issues;
      if (!page.bugs.length || issues.length > total)
        throw new AppError("ISSUE_PAGINATION_INVALID", "Trinity 分页未完整返回，未发布部分列表");
    }
    throw new AppError("ISSUE_PAGINATION_INVALID", "Trinity 分页超出 100 页预算，未发布部分列表");
  }
  private async read(scope: IssueScope, path: string, signal: AbortSignal, body?: unknown): Promise<unknown> {
    this.protocol ??= this.readProtocol(scope, signal);
    const protocol = await this.protocol;
    return this.readRequest(scope, path, signal, body, protocol);
  }
  private async readProtocol(scope: IssueScope, signal: AbortSignal) {
    const raw = await this.readRequest(scope, "/sys/user/userinfo", signal);
    const parsed = z.object({ code: z.literal(200), data: z.object({ apiVersion: z.string().min(1).max(200).regex(/^[^\r\n]+$/), isGray: z.boolean() }) }).safeParse(raw);
    if (!parsed.success) throw new AppError("TRINITY_PROTOCOL_INVALID", "Trinity 未返回当前账号的 API 版本及灰度配置，请重新登录并检查目标实例");
    return parsed.data.data;
  }
  private async readRequest(scope: IssueScope, path: string, signal: AbortSignal, body?: unknown, protocol?: { apiVersion: string; isGray: boolean }): Promise<unknown> {
    const base = instanceUrl(scope.connection.baseUrl);
    const token = (await this.resolveToken()).replace(/^Bearer\s+/i, "");
    const result = await this.request(base + path, {
      method: body === undefined ? "GET" : "POST",
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
      headers: { "X-Token": `Bearer ${token}`, "X-Platform": "trinity", ...(protocol ? { apiVersion: protocol.apiVersion, isGray: String(protocol.isGray) } : {}), Accept: "application/json", "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!result.ok) {
      await result.body?.cancel();
      throw new AppError("ISSUE_REMOTE_FAILED", `Trinity HTTP ${result.status}，未保存错误正文`);
    }
    const text = await readResponseText(result);
    try { return JSON.parse(text); }
    catch { throw new AppError("ISSUE_REMOTE_FAILED", "Trinity 返回无效 JSON，未保存响应正文"); }
  }
  async get(
    scope: IssueScope,
    key: string,
    signal: AbortSignal,
  ): Promise<RemoteIssue> {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(key))
      throw new AppError(
        "ISSUE_KEY_INVALID",
        "Trinity 编号只允许字母、数字、下划线和连字符",
      );
    const base = instanceUrl(scope.connection.baseUrl);
    const parsed = response.safeParse(await this.read(scope, "/quality/bugRedux/getByBugId?" + new URLSearchParams({ bugId: key }), signal));
    if (!parsed.success)
      throw new AppError(
        "ISSUE_REMOTE_FAILED",
        "Trinity 业务失败或详情字段契约不符，请验证目标实例；未保存错误正文",
      );
    const r = parsed.data.data;
    const issue = RemoteIssueSchema.parse({
      remoteId: r.id,
      ...(r.workitemId === undefined ? {} : { workitemId: r.workitemId }),
      key: r.bugId,
      instanceUrl: base,
      remoteProjectId: r.projectId,
      ownerId: r.assigneeId,
      typeId: "BUG",
      title: r.title,
      description: r.description ?? "",
      status: r.status,
      updatedAt: r.updateTime,
      versions: [],
      comments: [],
      attachments: [],
      warnings: [
        "Trinity 评论、附件及问题版本字段尚无已验证契约，未读取；仅依据 detail 文本预分析",
      ],
    });
    if (issue.key !== key)
      throw new AppError("ISSUE_KEY_MISMATCH", "Trinity 返回不同 BUG 编号");
    ScopePolicy.assert(scope, issue);
    return issue;
  }
}
