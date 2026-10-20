import { z } from "zod";
import { AppError } from "../../../contracts/src/error";

const headerText = z.string().min(1).max(200).regex(/^[\x20-\x7e]+$/).refine(value => value.trim().length > 0);
const protocol = z.object({
  apiVersion: headerText,
  // Trinity's XMLHttpRequest client sends an explicit null as the header value "null".
  isGray: z.union([z.boolean(), z.null()]).transform(String),
});
export type TrinityProtocol = z.infer<typeof protocol>;

export function trinityUserData(raw: unknown): Record<string, unknown> {
  const result = z.object({ code: z.number().int(), data: z.unknown().optional() }).safeParse(raw);
  if (!result.success) throw new AppError("ISSUE_LOGIN_FAILED", "Trinity 账号验证响应契约无效，未保存正文");
  if (result.data.code !== 200) throw new AppError("ISSUE_LOGIN_FAILED", `Trinity 账号验证失败（业务码 ${result.data.code}），请重新登录；未保存响应正文`);
  const data = z.record(z.string(), z.unknown()).safeParse(result.data.data);
  if (!data.success) throw new AppError("TRINITY_IDENTITY_REQUIRED", "Trinity 未返回账号信息，未保存连接");
  return data.data;
}

export function trinityProtocol(data: unknown): TrinityProtocol {
  const parsed = protocol.safeParse(data);
  if (!parsed.success) {
    const fields = z.record(z.string(), z.unknown()).safeParse(data);
    const shape = fields.success ? ["apiVersion", "isGray"].map(key => `${key}=${fieldShape(fields.data[key])}`).join("，") : `data=${fieldShape(data)}`;
    throw new AppError("TRINITY_PROTOCOL_INVALID", `Trinity 路由字段无效（${shape}），未选择默认版本或灰度值；未保存响应正文`);
  }
  return parsed.data;
}

function fieldShape(value: unknown): string {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value !== "string") return typeof value;
  if (!value.trim()) return "empty-string";
  return headerText.safeParse(value).success ? "string" : "invalid-string";
}
