import { z } from "zod";
import type { IssueAdapter } from "../../../core/src/issues/ports";
import type { IssueScope, RemoteIssue } from "../../../contracts/src/issues";
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
    if (scope.connection.kind !== "jira-http")
      throw new AppError("ISSUE_CONNECTION_INVALID", "不是 Jira 账号连接");
    const url = instanceUrl(scope.connection.baseUrl) + path;
    const response = await this.request(url, {
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
      headers: {
        Accept: "application/json",
        Authorization:
          "Basic " +
          Buffer.from(
            scope.connection.username + ":" + (await this.password()),
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
