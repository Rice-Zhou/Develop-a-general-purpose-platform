import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { AppError } from "../../../contracts/src/error";
import type { CliConfiguration } from "../../../contracts/src/analysis";
import type {
  DocumentBinding,
  DocumentSource,
  SourceCapture,
} from "../../../core/src/documents/ports";
import { runProcess } from "../process/run-process";
import { FeishuResponseSchema, parseFeishu } from "./block-parser";
export class FeishuCliSource implements DocumentSource {
  constructor(
    private readonly configuration: () => CliConfiguration | null,
    private readonly run: typeof runProcess = runProcess,
  ) {}
  async fetch(
    binding: DocumentBinding,
    signal: AbortSignal,
  ): Promise<SourceCapture> {
    let url: URL;
    try {
      url = new URL(binding.locator);
    } catch {
      throw new AppError("FEISHU_URL_DENIED", "请输入明确关联的飞书文档 URL");
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !/(^|\.)(feishu\.cn|larksuite\.com)$/.test(url.hostname) ||
      !/^\/(docx|wiki)\/[a-zA-Z0-9]+\/?$/.test(url.pathname) ||
      url.hash ||
      url.search
    )
      throw new AppError(
        "FEISHU_URL_DENIED",
        "只支持飞书 Docx/Wiki 完整文档 URL，不接受局部链接或其他域名",
      );
    const config = this.configuration();
    if (!config?.larkExecutable)
      throw new AppError("FEISHU_NOT_CONFIGURED", "请先在设置配置飞书 CLI");
    if (
      !isAbsolute(config.larkExecutable) ||
      !/\.exe$/i.test(config.larkExecutable)
    )
      throw new AppError("CLI_PATH_INVALID", "请选择飞书 CLI 的实际 exe 文件");
    const args = [
      "docs",
      "+fetch",
      "--api-version",
      "v2",
      "--doc-format",
      "xml",
      "--detail",
      "full",
      "--doc",
      url.href,
      "--as",
      config.identity,
      "--format",
      "json",
    ];
    const capture = async () => {
      const text = await this.run(config.larkExecutable, args, {
        cwd: process.cwd(),
        signal,
        timeoutMs: 30000,
        maxOutput: 16 * 1024 * 1024,
      });
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        throw new AppError(
          "FEISHU_PROTOCOL_INVALID",
          "飞书 CLI 没有返回 JSON，请检查版本或登录",
        );
      }
      parseFeishu(value);
      const document = FeishuResponseSchema.parse(value).data.document;
      return {
        bytes: Buffer.from(JSON.stringify({ ok: true, data: { document } })),
        revision:
          document.revision_id === undefined
            ? null
            : String(document.revision_id),
      };
    };
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = await capture();
      const after = await capture();
      if (
        before.revision !== after.revision ||
        !before.bytes.equals(after.bytes)
      )
        continue;
      return {
        ...before,
        hash: createHash("sha256").update(before.bytes).digest("hex"),
        fetchedAt: new Date().toISOString(),
      };
    }
    throw new AppError(
      "DOCUMENT_CHANGED",
      "飞书文档读取期间持续变化，未建立混合版本快照",
    );
  }
}
