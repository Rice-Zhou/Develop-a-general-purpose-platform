import { z } from "zod";
import {
  ScopePolicy,
} from "../../../core/src/issues/scope-policy";
import {
  RemoteIssueSchema,
  type IssueScope,
  type RemoteIssue,
  JIRA_INDEXED_STATUSES,
} from "../../../contracts/src/issues";
import { AppError } from "../../../contracts/src/error";
const id = z.union([z.string(), z.number()]).transform(String);
const record = z.object({
  id,
  key: z.string(),
  self: z.string(),
  fields: z.object({
    project: z.object({ key: z.string() }),
    assignee: z
      .object({ accountId: z.string().optional(), name: z.string().optional() })
      .nullable(),
    issuetype: z.object({ id }),
    summary: z.string(),
    description: z.unknown().optional(),
    status: z.object({ name: z.string() }),
    updated: z.string(),
    versions: z.array(z.object({ name: z.string() })).optional(),
    comment: z
      .object({
        total: z.number(),
        comments: z.array(z.object({ id, body: z.unknown() })),
      })
      .optional(),
    attachment: z
      .array(
        z.object({
          id,
          filename: z.string(),
          mimeType: z.string(),
          size: z.number(),
        }),
      )
      .optional(),
  }),
});
function prose(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  const pending: unknown[] = [value];
  const texts: string[] = [];
  let nodes = 0;
  while (pending.length) {
    if (++nodes > 20000)
      throw new AppError("ISSUE_TEXT_LIMIT", "Jira 富文本节点超过上限");
    const node = z
      .object({
        text: z.string().optional(),
        content: z.array(z.unknown()).optional(),
      })
      .parse(pending.pop());
    if (node.text) texts.push(node.text);
    if (node.content) pending.push(...node.content.slice().reverse());
  }
  return texts.join("\n");
}
export function normalizeJira(scope: IssueScope, input: unknown): RemoteIssue {
  const raw = record.parse(input);
  const f = raw.fields;
  const self = new URL(raw.self);
  const marker = self.pathname.indexOf("/rest/api/");
  if (marker < 0 || self.username || self.password || self.search || self.hash)
    throw new AppError("CLI_INSTANCE_MISMATCH", "问题 self 地址不能验证实例");
  const base = self.origin + self.pathname.slice(0, marker);
  const comments = f.comment?.comments ?? [];
  const warnings = [
    "附件仅记录元信息，未下载或解析",
    "Jira 富文本转换为文本，图片和复杂排版不作为已解析证据",
  ];
  if (!f.comment || f.comment.total > comments.length)
    warnings.push("评论未完整读取，结论仅依据已取得的评论");
  const issue = RemoteIssueSchema.parse({
    remoteId: raw.id,
    key: raw.key,
    instanceUrl: base,
    remoteProjectId: f.project.key,
    ownerId:
      (scope.connection.platform === "jira-cloud"
        ? f.assignee?.accountId
        : f.assignee?.name) ?? "__UNASSIGNED__",
    typeId: f.issuetype.id,
    title: f.summary,
    description: prose(f.description),
    status: f.status.name,
    updatedAt: f.updated,
    versions: (f.versions ?? []).map((v) => v.name),
    comments: comments.map((c) => ({ id: c.id, text: prose(c.body) })),
    attachments: (f.attachment ?? []).map((a) => ({
      id: a.id,
      name: a.filename,
      mediaType: a.mimeType,
      size: a.size,
    })),
    warnings,
  });
  ScopePolicy.assert(scope, issue);
  return issue;
}

export const quoteJql = (s: string) =>
    '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
export function jiraQuery(scope: IssueScope): string {
  if (!scope.binding.issueTypeIds?.length)
    throw new AppError("ISSUE_NOT_CONFIGURED", "请配置 BUG 类型 ID");
  return `project = ${quoteJql(scope.binding.projectKey)} AND assignee = ${quoteJql(scope.binding.owner)} AND issuetype in (${scope.binding.issueTypeIds.map(quoteJql).join(",")}) AND status in (${JIRA_INDEXED_STATUSES.map(quoteJql).join(",")})`;
}
export function assertJiraKey(scope: IssueScope, key: string): void {
  if (!/^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(key))
    throw new AppError("ISSUE_KEY_INVALID", "Jira 编号格式应为 PROJECT-123");
  if (key.slice(0, key.lastIndexOf("-")) !== scope.binding.projectKey)
    throw new AppError(
      "ISSUE_OUT_OF_SCOPE",
      "Jira 编号不属于配置项目，未启动读取命令",
    );
}
