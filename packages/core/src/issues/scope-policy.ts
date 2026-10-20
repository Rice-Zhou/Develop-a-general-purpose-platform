import { createHash } from "node:crypto";
import { AppError } from "../../../contracts/src/error";
import type { IssueScope, RemoteIssue } from "../../../contracts/src/issues";
import { isIssueStatusIndexed } from "../../../contracts/src/issues";
export const fingerprint = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function instanceUrl(value: string): string {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    )
  )
    throw new AppError(
      "ISSUE_URL_INVALID",
      "问题实例必须为 HTTPS 或本机测试地址，不能含凭据、查询或片段",
    );
  return url.href.replace(/\/$/, "");
}
export function bindingFingerprint(scope: IssueScope): string {
  return fingerprint({
    projectId: scope.projectId,
    binding: scope.binding,
    connection: scope.connection,
  });
}
export class ScopePolicy {
  static assertActiveStatus(scope: IssueScope, status: string): void {
    if (!isIssueStatusIndexed(scope.connection.platform, status))
      throw new AppError("ISSUE_STATUS_INACTIVE", `Jira 当前状态为“${status}”，已完成的问题不再展示或预分析，请刷新问题列表。`);
  }
  static validate(scope: IssueScope): void {
    if (!scope.enabled) throw new AppError("PROJECT_DISABLED", "项目已停用");
    if (
      scope.binding.connectionId !== scope.connection.id ||
      scope.binding.platform !== scope.connection.platform ||
      instanceUrl(scope.binding.instanceUrl) !==
        instanceUrl(scope.connection.baseUrl)
    )
      throw new AppError("ISSUE_OUT_OF_SCOPE", "来源连接、平台和实例不一致");
  }
  static assert(scope: IssueScope, issue: RemoteIssue): void {
    this.validate(scope);
    const { binding, connection } = scope;
    if (!scope.enabled) throw new AppError("PROJECT_DISABLED", "项目已停用");
    if (
      !binding.connectionId ||
      binding.connectionId !== connection.id ||
      binding.platform !== connection.platform ||
      instanceUrl(binding.instanceUrl) !== instanceUrl(connection.baseUrl) ||
      instanceUrl(issue.instanceUrl) !== instanceUrl(connection.baseUrl) ||
      issue.remoteProjectId !== binding.projectKey ||
      issue.ownerId !== binding.owner ||
      !binding.issueTypeIds?.includes(issue.typeId)
    )
      throw new AppError(
        "ISSUE_OUT_OF_SCOPE",
        "问题的实例、项目、类型或负责人不符合当前绑定，未保存材料",
      );
  }
}
