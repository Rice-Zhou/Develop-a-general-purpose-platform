import { AppError } from "../../../contracts/src/error";
export function zipManifest(bytes: Buffer): string[] {
  const invalid = () =>
    new AppError(
      "DOCUMENT_ZIP_INVALID",
      "DOCX 压缩目录无效或使用了未支持的 ZIP64 格式",
    );
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (
      bytes.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + bytes.readUInt16LE(i + 20) === bytes.length
    ) {
      end = i;
      break;
    }
  }
  if (end < 0) throw invalid();
  const count = bytes.readUInt16LE(end + 10);
  const size = bytes.readUInt32LE(end + 12);
  let offset = bytes.readUInt32LE(end + 16);
  if (count > 10000 || count === 0xffff || offset + size > end) throw invalid();
  const limit = offset + size;
  const names: string[] = [];
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > limit || bytes.readUInt32LE(offset) !== 0x02014b50)
      throw invalid();
    const expanded = bytes.readUInt32LE(offset + 24);
    total += expanded;
    if (expanded > 50 * 1024 * 1024 || total > 200 * 1024 * 1024)
      throw new AppError(
        "DOCUMENT_EXPANSION_LIMIT",
        "DOCX 展开内容超出解析预算",
      );
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extra = bytes.readUInt16LE(offset + 30);
    const comment = bytes.readUInt16LE(offset + 32);
    const next = offset + 46 + nameLength + extra + comment;
    if (next > limit) throw invalid();
    names.push(
      bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8"),
    );
    offset = next;
  }
  return names;
}
