import { AppError } from "../../../contracts/src/error";
import type { IssueScope, RemoteIssue } from "../../../contracts/src/issues";
import { ScopePolicy, instanceUrl } from "./scope-policy";

export function issueWebUrl(scope: IssueScope, issue: RemoteIssue): string {
  ScopePolicy.assert(scope, issue);
  const base = instanceUrl(scope.connection.baseUrl);
  if (scope.connection.platform === "trinity") {
    const params = new URLSearchParams({ projectId: issue.remoteProjectId, id: issue.remoteId, bugId: issue.key });
    if (issue.workitemId) params.set("workitemId", issue.workitemId);
    return new URL(base).origin + "/#/bug/newBugDetail?" + params;
  }
  if (!/^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(issue.key) || !issue.key.startsWith(scope.binding.projectKey + "-"))
    throw new AppError("ISSUE_LINK_INVALID", "Jira 问题号与配置项目不符");
  return base + "/browse/" + encodeURIComponent(issue.key);
}
