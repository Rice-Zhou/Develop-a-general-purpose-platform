import { downloadAttachmentFile } from "./attachment-download";
import type { AttachmentDescriptor } from "../../../contracts/src/issue-materials";
import { fingerprint } from "../../../core/src/issues/scope-policy";
import { z } from "zod";
import { AppError } from "../../../contracts/src/error";
import {
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
import { trinityData, trinityProtocol, trinityUserData, type TrinityProtocol } from "./trinity-session";
import { normalizeTrinity, trinityContractError } from "./trinity-format";
const MAX_ACCOUNT_ISSUES = 10000;
const ACCOUNT_PAGE_SIZE = 100;
export class TrinityAdapter implements IssueAdapter {
  private protocol: Promise<TrinityProtocol> | undefined;
  constructor(
    private readonly resolveToken: () => Promise<string>,
    private readonly request: typeof fetch = curlFetch as typeof fetch,
  ) {}
  async listAttachments(scope:IssueScope,issue:RemoteIssue,signal:AbortSignal):Promise<AttachmentDescriptor[]> {
    ScopePolicy.assert(scope,issue);
    if(!issue.workitemId)throw new AppError("ISSUE_ATTACHMENTS_UNSUPPORTED","Trinity 未返回工作项 ID，无法验证附件范围");
    const raw=await this.read(scope,"/storage/attachments/findByTypeAndDataId?"+new URLSearchParams({type:"quality-bug-file",dataId:`${issue.remoteProjectId}_${issue.workitemId}`}),signal);
    const parsed=z.array(z.object({id:z.union([z.string().min(1),z.number().int()]).transform(String),name:z.string().min(1),fileSize:z.number().nonnegative().nullish(),size:z.number().nonnegative().nullish(),createTime:z.string().nullish(),updateTime:z.string().nullish()})).max(500).safeParse(trinityData(raw,"问题附件"));
    if(!parsed.success)throw new AppError("ISSUE_ATTACHMENTS_INVALID","Trinity 附件列表契约不符，未当作无日志处理");
    return parsed.data.map(row=>({id:row.id,name:row.name,mediaType:row.name.toLowerCase().endsWith(".zip")?"application/zip":"application/octet-stream",size:row.fileSize??row.size??null,version:fingerprint({row,issueVersion:issue.updatedAt})}));
  }
  async downloadAttachment(scope:IssueScope,issue:RemoteIssue,attachmentId:string,destination:string,signal:AbortSignal,maxBytes?:number) {
    const current=await this.get(scope,issue.key,signal);ScopePolicy.assert(scope,current);
    if(current.updatedAt!==issue.updatedAt)throw new AppError("ISSUE_CHANGED","问题在下载前已变化，请刷新");
    const files=await this.listAttachments(scope,current,signal);
    if(!files.some(file=>file.id===attachmentId))throw new AppError("ISSUE_ATTACHMENT_DENIED","附件不属于当前问题");
    const protocol=await this.protocol!;
    const base=instanceUrl(scope.connection.baseUrl);
    return downloadAttachmentFile(base+"/storage/attachments/download?"+new URLSearchParams({id:attachmentId}),base,{"X-Token":await this.resolveToken(),"X-Platform":"trinity",...protocol},destination,signal,"POST",maxBytes);
  }
  async list(scope: IssueScope, signal: AbortSignal): Promise<RemoteIssue[]> {
    ScopePolicy.validate(scope);
    if (scope.binding.scopeMode === "account") return this.listAccount(scope, signal);
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
  private async listAccount(scope: IssueScope, signal: AbortSignal): Promise<RemoteIssue[]> {
    const issues: RemoteIssue[] = []; const seen = new Set<string>(); let total: number | undefined;
    const pageSchema = z.object({total:z.number().int().nonnegative(),current:z.number().int().positive().optional(),records:z.array(z.object({bugId:z.string().min(1).max(200)})).max(ACCOUNT_PAGE_SIZE)});
    for (let pageNum=1;pageNum<=100;pageNum++) {
      const raw = await this.read(scope,"/quality/bugRedux/getBugsByMultiProjects",signal,{
        fields:["bugId","projectId","title","assigneeId","status"],allProjects:true,projectIds:[],pageNum,pageSize:ACCOUNT_PAGE_SIZE,
        bugReduxCustomConditionsQueryBO:{logicalOperator:"and",conditions:[{id:1,field:"assigneeId",operation:"EQ",values:[scope.binding.owner],type:"SINGLEUSER",fieldType:"STRING"}]},
      });
      const data=trinityData(raw,"账号问题列表");
      const parsed=pageSchema.safeParse(typeof data==="object"&&data!==null&&"page" in data?data.page:data);
      if(!parsed.success)throw trinityContractError("账号问题列表",parsed.error);
      const page=parsed.data;
      if(page.total>MAX_ACCOUNT_ISSUES)throw new AppError("ISSUE_QUERY_TOO_BROAD",`Trinity 返回问题数超过 ${MAX_ACCOUNT_ISSUES}，负责人筛选可能未生效；未读取详情或发布列表`);
      if((page.current!==undefined&&page.current!==pageNum)||(total!==undefined&&total!==page.total))throw new AppError("ISSUE_PAGINATION_INVALID","Trinity 账号问题分页或总数变化，请重新刷新");
      total=page.total;
      for(const row of page.records){if(seen.has(row.bugId))throw new AppError("ISSUE_PAGINATION_INVALID","Trinity 账号问题分页重复");seen.add(row.bugId);issues.push(await this.get(scope,row.bugId,signal));}
      if(issues.length===total)return issues;
      if(!page.records.length||issues.length>total)throw new AppError("ISSUE_PAGINATION_INVALID","Trinity 账号问题分页不完整，未发布部分列表");
    }
    throw new AppError("ISSUE_PAGINATION_INVALID","Trinity 账号问题分页超出预算");
  }
  private async read(scope: IssueScope, path: string, signal: AbortSignal, body?: unknown): Promise<unknown> {
    this.protocol ??= this.readProtocol(scope, signal);
    const protocol = await this.protocol;
    return this.readRequest(scope, path, signal, body, protocol);
  }
  private async readProtocol(scope: IssueScope, signal: AbortSignal) {
    const raw = await this.readRequest(scope, "/sys/user/userinfo", signal);
    return trinityProtocol(trinityUserData(raw));
  }
  private async readRequest(scope: IssueScope, path: string, signal: AbortSignal, body?: unknown, protocol?: TrinityProtocol): Promise<unknown> {
    const base = instanceUrl(scope.connection.baseUrl);
    const token = await this.resolveToken();
    const result = await this.request(base + path, {
      method: body === undefined ? "GET" : "POST",
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
      headers: { "X-Token": token, "X-Platform": "trinity", ...protocol, Accept: "application/json", "Content-Type": "application/json" },
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
    return normalizeTrinity(scope,key,await this.read(scope, "/quality/bugRedux/getByBugId?" + new URLSearchParams({ bugId: key }), signal));
  }
}
