import { AppError } from "../../../contracts/src/error";
export async function readResponseText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new AppError("ISSUE_REMOTE_FAILED", "平台响应没有正文");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 8 * 1024 * 1024)
        throw new AppError("ISSUE_OUTPUT_LIMIT", "平台响应超过8 MiB");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks).toString("utf8");
}
