import { isAbsolute } from "node:path";
import { z } from "zod";
import { AppError } from "../../../contracts/src/error";
import type { CliConfiguration } from "../../../contracts/src/analysis";
import type { IssueNotification, IssueNotifier, NotificationRecipient } from "../../../contracts/src/issue-monitor";
import { NotificationOpenIdSchema, RecipientQuerySchema } from "../../../contracts/src/issue-monitor";
import { ProcessExitError, runProcess } from "../process/run-process";

function authorizationError(raw: unknown): AppError | null {
  const result=z.object({ok:z.literal(false),identity:z.string().optional(),error:z.object({type:z.literal("authentication")})}).safeParse(raw);
  if(!result.success)return null;
  return result.data.identity==="bot"
    ? new AppError("FEISHU_BOT_AUTH_REQUIRED","飞书机器人授权不可用，请检查本机飞书 CLI 的应用配置和机器人发消息权限；通知保留待发送")
    : new AppError("FEISHU_AUTH_REQUIRED","飞书用户授权已失效或尚未完成，请在本机终端执行 lark-cli auth login 重新授权后重试；已保存的接收人和待发通知保留");
}

export class FeishuIssueNotifier implements IssueNotifier {
  constructor(
    private readonly configuration: () => CliConfiguration,
    private readonly run: typeof runProcess = runProcess,
  ) {}
  private async command(args: string[], signal: AbortSignal): Promise<unknown> {
    const { larkExecutable } = this.configuration();
    if (!larkExecutable) throw new AppError("FEISHU_NOT_CONFIGURED", "请在设置配置飞书 CLI；新问题通知已保留待发送");
    if (!isAbsolute(larkExecutable) || !/\.exe$/i.test(larkExecutable))
      throw new AppError("CLI_PATH_INVALID", "请配置飞书 CLI 实际 exe 文件的绝对路径");
    let text: string;
    try { text = await this.run(larkExecutable, args, { cwd: process.cwd(), signal, timeoutMs: 30000, maxOutput: 1024 * 1024 }); }
    catch(error) {
      if(error instanceof ProcessExitError) {
        let raw:unknown;try {raw=JSON.parse(error.diagnostic);} catch {throw error;}
        const failure=authorizationError(raw);if(failure)throw failure;
      }
      throw error;
    }
    let raw:unknown;
    try { raw=JSON.parse(text); }
    catch { throw new AppError("FEISHU_PROTOCOL_INVALID", "飞书 CLI 返回无效 JSON，请检查版本和登录状态"); }
    const failure=authorizationError(raw);if(failure)throw failure;
    return raw;
  }
  async search(query: string, signal: AbortSignal) {
    const keyword=RecipientQuerySchema.parse(query);
    const raw=await this.command(["contact","+search-user","--query",keyword,"--as","user","--page-size","30","--format","json"],signal);
    const result=z.object({ok:z.literal(true),data:z.object({users:z.array(z.object({open_id:NotificationOpenIdSchema,localized_name:z.string().min(1).max(200),department:z.string().max(500).optional()})).max(30),has_more:z.boolean()})}).safeParse(raw);
    if(!result.success)throw new AppError("FEISHU_SEARCH_FAILED","飞书姓名搜索失败或 CLI 响应格式不符，请检查用户授权及 CLI 版本；未保存响应正文");
    return {users:result.data.data.users.map(user=>({openId:user.open_id,name:user.localized_name,...(user.department!==undefined?{department:user.department}:{})})),hasMore:result.data.data.has_more};
  }
  async self(signal: AbortSignal): Promise<NotificationRecipient> {
    const raw = await this.command(["api", "GET", "/open-apis/authen/v1/user_info", "--as", "user", "--format", "json"], signal);
    const parsed = z.object({ code: z.literal(0), data: z.object({ open_id: z.string().regex(/^ou_[A-Za-z0-9_-]+$/), name: z.string().min(1).max(200) }) }).safeParse(raw);
    if (!parsed.success) throw new AppError("FEISHU_USER_UNAVAILABLE", "无法确认飞书 CLI 当前登录用户，请完成用户授权并检查 CLI 接口版本");
    return { openId: parsed.data.data.open_id, name: parsed.data.data.name };
  }
  async send(event: IssueNotification, recipient: NotificationRecipient, signal: AbortSignal, authorize: () => void): Promise<void> {
    z.object({ id: z.uuid(), text: z.string().min(1).max(16000) }).parse(event);
    const openId=NotificationOpenIdSchema.parse(recipient.openId);
    authorize();
    const raw = await this.command([
      "im", "+messages-send", "--as", "bot", "--user-id", openId,
      "--text", event.text, "--idempotency-key", event.id, "--format", "json",
    ], signal);
    if (!z.object({ ok: z.literal(true), data: z.object({ message_id: z.string().min(1) }) }).safeParse(raw).success)
      throw new AppError("FEISHU_NOTIFICATION_FAILED", "飞书没有返回消息回执，请检查机器人发消息权限；通知保留待发送");
  }
}
