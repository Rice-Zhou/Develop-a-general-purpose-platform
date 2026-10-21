import { load } from "cheerio";
import { z } from "zod";
import { AppError } from "../../../contracts/src/error";
import { RemoteIssueSchema, type IssueScope, type RemoteIssue } from "../../../contracts/src/issues";
import { instanceUrl, ScopePolicy } from "../../../core/src/issues/scope-policy";
import { trinityData } from "./trinity-session";

const id = z.union([z.string().min(1), z.number()]).transform(String);
const text = z.string().max(200000).nullable();
const common = z.object({ id, bugId: z.string().min(1), projectId: id, projectName: z.string().trim().max(2048).nullish(), assigneeId: id, title: z.string(), status: id, workitemId: id.optional() });
const structured = common.extend({ condition: text, activities: text, expectedResult: text, actualResult: text, causeAnalysis: text.optional(), solvedScheme: text.optional(), modifyTime: z.string().min(1) });
const legacy = common.extend({ description: text, updateTime: z.string().min(1) });

export function trinityContractError(operation: string, error: z.ZodError): AppError {
  const paths = error.issues.slice(0, 5).map(issue => issue.path.map(String).join(".") || "data").join("、");
  return new AppError("ISSUE_REMOTE_FAILED", `Trinity ${operation}响应字段不符：${paths}；未保存响应正文`);
}

function plainText(html: string | null | undefined): string {
  if (!html) return "";
  const $ = load(html);
  $("script,style").remove();
  $("br").replaceWith("\n");
  $("p,div,li,tr").append("\n");
  return $.text().replace(/\n{3,}/g, "\n\n").trim();
}

export function normalizeTrinity(scope: IssueScope, key: string, raw: unknown): RemoteIssue {
  const data = trinityData(raw, "问题详情");
  const isStructured = typeof data === "object" && data !== null && ("modifyTime" in data || "condition" in data);
  const parsed = isStructured ? structured.safeParse(data) : legacy.safeParse(data);
  if (!parsed.success) throw trinityContractError("问题详情", parsed.error);
  const value = parsed.data;
  const description = "modifyTime" in value ? [
    ["前置条件", value.condition], ["操作步骤", value.activities], ["预期结果", value.expectedResult], ["实际结果", value.actualResult],
    ["已有原因分析", value.causeAnalysis], ["已有解决方案", value.solvedScheme],
  ].map(([label, html]) => { const content = plainText(html); return content ? `${label}：\n${content}` : ""; }).filter(Boolean).join("\n\n") : value.description ?? "";
  const result = RemoteIssueSchema.safeParse({
    remoteId: value.id, ...(value.workitemId === undefined ? {} : { workitemId: value.workitemId }), key: value.bugId,
    instanceUrl: instanceUrl(scope.connection.baseUrl), remoteProjectId: value.projectId, ...(value.projectName?{remoteProjectName:value.projectName}:{}), ownerId: value.assigneeId, typeId: "BUG", title: value.title,
    description, status: value.status, updatedAt: "modifyTime" in value ? value.modifyTime : value.updateTime,
    versions: [], comments: [], attachments: [], warnings: ["Trinity 评论及问题版本字段尚无已验证契约，未读取"],
  });
  if (!result.success) throw trinityContractError("规范化详情", result.error);
  const issue = result.data;
  if (issue.key !== key) throw new AppError("ISSUE_KEY_MISMATCH", "Trinity 返回不同 BUG 编号");
  ScopePolicy.assert(scope, issue);
  return issue;
}
