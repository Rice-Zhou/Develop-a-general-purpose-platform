import { attachmentUrl, downloadAttachmentFile } from "./attachment-download";
import type { AttachmentDescriptor } from "../../../contracts/src/issue-materials";
import { fingerprint } from "../../../core/src/issues/scope-policy";
import { z } from "zod";
import type { IssueAdapter } from "../../../core/src/issues/ports";
import type { IssueConnection, IssueScope, RemoteIssue, JiraCatalogue } from "../../../contracts/src/issues";
import { AppError } from "../../../contracts/src/error";
import {
  instanceUrl,
  ScopePolicy,
} from "../../../core/src/issues/scope-policy";
import { normalizeJira, jiraQuery, assertJiraKey } from "./jira-format";
import { readResponseText } from "../network/response";
import { fetchDirect } from "../network/policy";
export class JiraHttpAdapter implements IssueAdapter {
  constructor(
    private readonly password: () => Promise<string>,
    private readonly request: typeof fetch = fetchDirect as unknown as typeof fetch,
  ) {}
  private async json(
    scope: IssueScope,
    path: string,
    signal: AbortSignal,
  ): Promise<unknown> {
    ScopePolicy.validate(scope);
    return this.connectionJson(scope.connection, path, signal);
  }
  private async connectionJson(connection: IssueConnection, path: string, signal: AbortSignal): Promise<unknown> {
    if (connection.kind !== "jira-http")
      throw new AppError("ISSUE_CONNECTION_INVALID", "不是 Jira 账号连接");
    const url = instanceUrl(connection.baseUrl) + path;
    const response = await this.request(url, {
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
      headers: {
        Accept: "application/json",
        Authorization:
          "Basic " +
          Buffer.from(
            connection.username + ":" + (await this.password()),
          ).toString("base64"),
      },
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new AppError(
        "ISSUE_REMOTE_FAILED",
        `Jira HTTP ${response.status}，请检查登录、权限或验证码要求；未保存错误正文`,
      );
    }
    const body = await readResponseText(response);
    try {
      return JSON.parse(body);
    } catch {
      throw new AppError(
        "ISSUE_REMOTE_FAILED",
        "Jira 响应不是有效 JSON，未保存正文",
      );
    }
  }
  private async attachmentRows(scope:IssueScope,issue:RemoteIssue,signal:AbortSignal) {
    ScopePolicy.assert(scope,issue);assertJiraKey(scope,issue.key);
    const parsed=z.object({key:z.literal(issue.key),fields:z.object({attachment:z.array(z.object({id:z.string().min(1),filename:z.string().min(1),mimeType:z.string(),size:z.number().int().nonnegative(),content:z.string()})).max(500)})}).safeParse(await this.json(scope,"/rest/api/2/issue/"+encodeURIComponent(issue.key)+"?fields=attachment",signal));
    if(!parsed.success)throw new AppError("ISSUE_ATTACHMENTS_INVALID","Jira 附件响应契约不符");
    return parsed.data.fields.attachment.map(row=>({...row,content:attachmentUrl(row.content,scope.connection.baseUrl)}));
  }
  async listAttachments(scope:IssueScope,issue:RemoteIssue,signal:AbortSignal):Promise<AttachmentDescriptor[]> {
    return (await this.attachmentRows(scope,issue,signal)).map(row=>({id:row.id,name:row.filename,mediaType:row.mimeType,size:row.size,version:fingerprint({id:row.id,size:row.size,name:row.filename,issueVersion:issue.updatedAt})}));
  }
  async downloadAttachment(scope:IssueScope,issue:RemoteIssue,attachmentId:string,destination:string,signal:AbortSignal) {
    const current=await this.get(scope,issue.key,signal);ScopePolicy.assert(scope,current);
    if(current.updatedAt!==issue.updatedAt)throw new AppError("ISSUE_CHANGED","问题在下载前已变化，请刷新");
    const file=(await this.attachmentRows(scope,current,signal)).find(row=>row.id===attachmentId);
    if(!file||scope.connection.kind!=="jira-http")throw new AppError("ISSUE_ATTACHMENT_DENIED","附件不属于当前问题");
    return downloadAttachmentFile(file.content,scope.connection.baseUrl,{Authorization:"Basic "+Buffer.from(scope.connection.username+":"+await this.password()).toString("base64")},destination,signal);
  }
  async discover(connection: IssueConnection, signal: AbortSignal): Promise<JiraCatalogue> {
    const identity = z.object({ name: z.string().trim().min(1) }).parse(await this.connectionJson(connection, "/rest/api/2/myself", signal));
    if (connection.kind !== "jira-http" || identity.name !== connection.username)
      throw new AppError("ISSUE_LOGIN_FAILED", "Jira 登录身份不匹配");
    const projects = z.array(z.object({ key: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/), name: z.string().min(1) })).max(10000).parse(await this.connectionJson(connection, "/rest/api/2/project", signal));
    const issueTypes = z.array(z.object({ id: z.string().min(1), name: z.string().min(1) })).max(1000).parse(await this.connectionJson(connection, "/rest/api/2/issuetype", signal));
    return { owner: identity.name, projects, issueTypes, typeSource: "server" };
  }
  async probe(scope: IssueScope, signal: AbortSignal): Promise<void> {
    const identity = z
      .object({ name: z.string() })
      .safeParse(await this.json(scope, "/rest/api/2/myself", signal));
    if (
      !identity.success ||
      scope.connection.kind !== "jira-http" ||
      identity.data.name !== scope.connection.username
    )
      throw new AppError("ISSUE_LOGIN_FAILED", "Jira 登录身份不匹配");
  }
  async get(
    scope: IssueScope,
    key: string,
    signal: AbortSignal,
  ): Promise<RemoteIssue> {
    assertJiraKey(scope, key);
    const issue = normalizeJira(
      scope,
      await this.json(
        scope,
        "/rest/api/2/issue/" + encodeURIComponent(key),
        signal,
      ),
    );
    if (issue.key !== key)
      throw new AppError("ISSUE_KEY_MISMATCH", "Jira 返回不同问题编号");
    return issue;
  }
  async list(scope: IssueScope, signal: AbortSignal): Promise<RemoteIssue[]> {
    await this.probe(scope, signal);
    const jql = jiraQuery(scope) + " ORDER BY key ASC";
    const result: RemoteIssue[] = [];
    const seen = new Set<string>();
    for (let page = 0; page < 100; page++) {
      const query = new URLSearchParams({
        jql,
        startAt: String(result.length),
        maxResults: "100",
        fields:
          "project,assignee,issuetype,summary,description,status,updated,versions,comment,attachment",
      });
      const parsed = z
        .object({
          startAt: z.number().int().nonnegative(),
          total: z.number().int().nonnegative(),
          issues: z.array(z.unknown()).max(100),
        })
        .safeParse(
          await this.json(scope, "/rest/api/2/search?" + query, signal),
        );
      if (!parsed.success || parsed.data.startAt !== result.length)
        throw new AppError(
          "ISSUE_PAGINATION_INVALID",
          "Jira 分页格式或起点不匹配，未发布部分列表",
        );
      const data = parsed.data;
      if (data.total > 5000)
        throw new AppError(
          "ISSUE_LIST_LIMIT",
          "范围内问题超过5000条，请缩小范围",
        );
      for (const item of data.issues) {
        const issue = normalizeJira(scope, item);
        assertJiraKey(scope, issue.key);
        if (seen.has(issue.key) || seen.has("id:" + issue.remoteId))
          throw new AppError(
            "ISSUE_PAGINATION_INVALID",
            "Jira 分页重复，未发布部分列表",
          );
        seen.add(issue.key);
        seen.add("id:" + issue.remoteId);
        result.push(issue);
        if (result.length > 5000)
          throw new AppError("ISSUE_LIST_LIMIT", "范围内问题超过5000条");
      }
      if (result.length > data.total)
        throw new AppError(
          "ISSUE_PAGINATION_INVALID",
          "Jira 分页总数不一致，未发布部分列表",
        );
      if (result.length >= data.total) return result;
      if (!data.issues.length)
        throw new AppError(
          "ISSUE_PAGINATION_INVALID",
          "Jira 分页不完整，未发布部分列表",
        );
    }
    throw new AppError("ISSUE_LIST_LIMIT", "Jira 分页超过100页");
  }
}
