import { open } from "node:fs/promises";
import { isScalar, isSeq, parseDocument } from "yaml";
import { AppError } from "../../../contracts/src/error";
import { z } from "zod";
const CONFIG_LIMIT = 1024 * 1024;
async function readConfig(path: string) {
  const file = await open(path, "r");
  try {
    if (!(await file.stat()).isFile())
      throw new AppError("CLI_CONFIG_INVALID", "Jira 配置必须为普通文件");
    const bytes = Buffer.alloc(CONFIG_LIMIT + 1);
    let size = 0;
    while (size < bytes.length) {
      const read = await file.read(bytes, size, bytes.length - size, null);
      if (!read.bytesRead) break;
      size += read.bytesRead;
    }
    if (size > CONFIG_LIMIT)
      throw new AppError("CLI_CONFIG_INVALID", "Jira 配置超过 1 MiB");
    const document = parseDocument(bytes.subarray(0, size).toString("utf8"), {
      uniqueKeys: true,
    });
    // Callers select approved metadata; never serialize or log the full document.
    if (document.errors.length)
      throw new AppError(
        "CLI_CONFIG_INVALID",
        "Jira 配置 YAML 无效，未输出配置内容",
      );
    return document;
  } finally {
    await file.close();
  }
}
export async function readJiraServer(path: string): Promise<string> {
    const document = await readConfig(path);
    const server = document.get("server", true);
    if (!isScalar(server) || typeof server.value !== "string")
      throw new AppError(
        "CLI_CONFIG_INVALID",
        "Jira 配置 server 必须为明确的字符串，不能是别名或表达式",
      );
    return server.value;
}
export async function readJiraTypes(path: string): Promise<{ id: string; name: string }[]> {
  const document = await readConfig(path);
  const types = document.getIn(["issue", "types"]);
  const parsed = z.array(z.object({ id: z.string().min(1), name: z.string().min(1) })).min(1).max(1000).safeParse(isSeq(types) ? types.toJSON() : types);
  if (!parsed.success)
    throw new AppError("CLI_METADATA_MISSING", "Jira CLI 配置缺少有效的缺陷类型信息，请更新 CLI 初始化配置或使用账号密码登录读取。");
  return parsed.data;
}
