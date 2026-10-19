import { isAbsolute } from "node:path";
import { z } from "zod";
import { AppError } from "../../../contracts/src/error";
import type { CliConfiguration } from "../../../contracts/src/analysis";
import type { IssueNotification, IssueNotifier, NotificationRecipient } from "../../../contracts/src/issue-monitor";
import { runProcess } from "../process/run-process";

export class FeishuIssueNotifier implements IssueNotifier {
  constructor(
    private readonly configuration: () => CliConfiguration,
    private readonly run: typeof runProcess = runProcess,
  ) {}
  private async command(args: string[], signal: AbortSignal): Promise<unknown> {
    const { larkExecutable } = this.configuration();
    if (!larkExecutable) throw new AppError("FEISHU_NOT_CONFIGURED", "请在设置配置飞书 CLI 并登录用户；新问题通知已保留待发送");
    if (!isAbsolute(larkExecutable) || !/\.exe$/i.test(larkExecutable))
      throw new AppError("CLI_PATH_INVALID", "请配置飞书 CLI 实际 exe 文件的绝对路径");
    const text = await this.run(larkExecutable, args, { cwd: process.cwd(), signal, timeoutMs: 30000, maxOutput: 1024 * 1024 });
    try { return JSON.parse(text); }
    catch { throw new AppError("FEISHU_PROTOCOL_INVALID", "飞书 CLI 返回无效 JSON，请检查版本和登录状态"); }
  }
  async self(signal: AbortSignal): Promise<NotificationRecipient> {
    const raw = await this.command(["api", "GET", "/open-apis/authen/v1/user_info", "--as", "user", "--format", "json"], signal);
    const parsed = z.object({ code: z.literal(0), data: z.object({ open_id: z.string().regex(/^ou_[A-Za-z0-9_-]+$/), name: z.string().min(1).max(200) }) }).safeParse(raw);
    if (!parsed.success) throw new AppError("FEISHU_USER_UNAVAILABLE", "无法确认飞书 CLI 当前登录用户，请完成用户授权并检查 CLI 接口版本");
    return { openId: parsed.data.data.open_id, name: parsed.data.data.name };
  }
  async send(event: IssueNotification, recipient: NotificationRecipient, signal: AbortSignal, authorize: () => void): Promise<void> {
    z.object({ id: z.uuid(), text: z.string().min(1).max(16000) }).parse(event);
    const current = await this.self(signal);
    if (current.openId !== recipient.openId)
      throw new AppError("FEISHU_IDENTITY_CHANGED", "飞书 CLI 登录用户已变化，已停止通知，请恢复原通知接收账号后重试");
    authorize();
    const raw = await this.command([
      "im", "+messages-send", "--as", "bot", "--user-id", current.openId,
      "--text", event.text, "--idempotency-key", event.id, "--format", "json",
    ], signal);
    if (!z.object({ ok: z.literal(true), data: z.object({ message_id: z.string().min(1) }) }).safeParse(raw).success)
      throw new AppError("FEISHU_NOTIFICATION_FAILED", "飞书没有返回消息回执，请检查机器人发消息权限；通知保留待发送");
  }
}
