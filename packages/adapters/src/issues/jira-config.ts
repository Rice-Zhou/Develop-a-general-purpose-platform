import { open } from "node:fs/promises";
import { isScalar, parseDocument } from "yaml";
import { AppError } from "../../../contracts/src/error";
const CONFIG_LIMIT = 1024 * 1024;
export async function readJiraServer(path: string): Promise<string> {
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
    // Inspect only non-secret server metadata. Never serialize or log the remaining document.
    if (document.errors.length)
      throw new AppError(
        "CLI_CONFIG_INVALID",
        "Jira 配置 YAML 无效，未输出配置内容",
      );
    const server = document.get("server", true);
    if (!isScalar(server) || typeof server.value !== "string")
      throw new AppError(
        "CLI_CONFIG_INVALID",
        "Jira 配置 server 必须为明确的字符串，不能是别名或表达式",
      );
    return server.value;
  } finally {
    await file.close();
  }
}
