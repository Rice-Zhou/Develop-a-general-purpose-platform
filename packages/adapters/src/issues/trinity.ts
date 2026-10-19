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
  }),
});
export class TrinityAdapter implements IssueAdapter {
  constructor(
    private readonly resolveToken: () => Promise<string>,
    private readonly request: typeof fetch = curlFetch as typeof fetch,
  ) {}
  async list(): Promise<RemoteIssue[]> {
    throw new AppError(
      "TRINITY_LIST_UNVERIFIED",
      "Trinity 项目列表契约尚未验证，请使用按 BUG 编号读取；未请求全账户列表",
    );
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
    const url = new URL(base + "/quality/bugRedux/getByBugId");
    url.searchParams.set("bugId", key);
    const token = (await this.resolveToken()).replace(/^Bearer\s+/i, "");
    const result = await this.request(url, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
      headers: {
        "X-Token": `Bearer ${token}`,
        "X-Platform": "trinity",
        apiVersion: "Trinity V6.5.0",
        isGray: "false",
        Accept: "application/json",
      },
    });
    if (!result.ok) {
      await result.body?.cancel();
      throw new AppError(
        "ISSUE_REMOTE_FAILED",
        `Trinity HTTP ${result.status}，未保存错误正文`,
      );
    }
    const parsed = response.safeParse(
      JSON.parse(await readResponseText(result)),
    );
    if (!parsed.success)
      throw new AppError(
        "ISSUE_REMOTE_FAILED",
        "Trinity 业务失败或 V6.5 字段契约不符，请验证目标实例；未保存错误正文",
      );
    const r = parsed.data.data;
    const issue = RemoteIssueSchema.parse({
      remoteId: r.id,
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
