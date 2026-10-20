import { z } from "zod";
import { AppError } from "../../../contracts/src/error";

const protocol = z.object({
  apiVersion: z.string().min(1).max(200).regex(/^[^\r\n]+$/),
  isGray: z.boolean(),
});

export function trinityUserData(raw: unknown): Record<string, unknown> {
  const result = z.object({ code: z.number().int(), data: z.unknown().optional() }).safeParse(raw);
  if (!result.success) throw new AppError("ISSUE_LOGIN_FAILED", "Trinity 账号验证响应契约无效，未保存正文");
  if (result.data.code !== 200) throw new AppError("ISSUE_LOGIN_FAILED", `Trinity 账号验证失败（业务码 ${result.data.code}），请重新登录；未保存响应正文`);
  const data = z.record(z.string(), z.unknown()).safeParse(result.data.data);
  if (!data.success) throw new AppError("TRINITY_IDENTITY_REQUIRED", "Trinity 未返回账号信息，未保存连接");
  return data.data;
}

export function trinityProtocol(data: unknown): { apiVersion: string; isGray: boolean } {
  const parsed = protocol.safeParse(data);
  if (!parsed.success) throw new AppError("TRINITY_PROTOCOL_INVALID", "Trinity 未返回有效的 API 版本及灰度配置，请检查目标实例；未保存响应正文");
  return parsed.data;
}
