import { open, lstat, realpath } from "node:fs/promises";
import { extname } from "node:path";
import { createHash } from "node:crypto";
import { AppError } from "../../../contracts/src/error";
import type {
  DocumentSource,
  DocumentBinding,
  SourceCapture,
} from "../../../core/src/documents/ports";
const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
export class LocalDocumentSource implements DocumentSource {
  constructor(private readonly maxBytes = 50 * 1024 * 1024) {}
  async fetch(
    binding: DocumentBinding,
    signal: AbortSignal,
  ): Promise<SourceCapture> {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (signal.aborted) throw new AppError("CANCELLED", "文档读取已取消");
      if (
        !["pdf", "docx"].includes(binding.kind) ||
        extname(binding.locator).toLowerCase() !== "." + binding.kind
      )
        throw new AppError("DOCUMENT_TYPE_MISMATCH", "文档类型与扩展名不符");
      const entry = await lstat(binding.locator);
      if (!entry.isFile() || entry.isSymbolicLink())
        throw new AppError(
          "DOCUMENT_PATH_DENIED",
          "文档必须是普通文件，不能是符号链接",
        );
      const canonical = await realpath(binding.locator);
      const handle = await open(canonical, "r");
      try {
        const before = await handle.stat();
        if (before.size > this.maxBytes)
          throw new AppError(
            "DOCUMENT_SIZE_LIMIT",
            `文档超过 ${this.maxBytes} 字节限制`,
          );
        const buffer = Buffer.alloc(before.size + 1);
        const first = await handle.read(buffer, 0, buffer.length, 0);
        const bytes = Buffer.from(buffer.subarray(0, first.bytesRead));
        const second = Buffer.alloc(before.size + 1);
        const check = await handle.read(second, 0, second.length, 0);
        const after = await handle.stat();
        const current = await lstat(binding.locator);
        if (
          before.dev !== entry.dev ||
          before.ino !== entry.ino ||
          current.dev !== before.dev ||
          current.ino !== before.ino ||
          current.isSymbolicLink() ||
          before.mtimeMs !== after.mtimeMs ||
          before.ctimeMs !== after.ctimeMs ||
          before.size !== after.size ||
          !bytes.equals(second.subarray(0, check.bytesRead))
        )
          continue;
        if (signal.aborted) throw new AppError("CANCELLED", "文档读取已取消");
        const valid =
          binding.kind === "pdf"
            ? bytes.subarray(0, 5).toString() === "%PDF-"
            : bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 3, 4]));
        if (!valid)
          throw new AppError(
            "DOCUMENT_TYPE_MISMATCH",
            "文件内容不是所选 DOCX/PDF 格式",
          );
        return {
          bytes,
          hash: digest(bytes),
          fetchedAt: new Date().toISOString(),
          revision: null,
        };
      } finally {
        await handle.close();
      }
    }
    throw new AppError(
      "DOCUMENT_CHANGED",
      "文档读取期间持续变化，请停止编辑后重试",
    );
  }
}
