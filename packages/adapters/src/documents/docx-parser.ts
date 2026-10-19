import mammoth from "mammoth";
import { load } from "cheerio";
import type {
  DocumentBlock,
  DocumentWarning,
  ParsedDocument,
} from "../../../contracts/src/documents";
import { AppError } from "../../../contracts/src/error";
import { zipManifest } from "./zip-manifest";
export async function parseDocx(bytes: Buffer): Promise<ParsedDocument> {
  const parts = zipManifest(bytes);
  const converted = await mammoth.convertToHtml(
    { buffer: bytes },
    {
      externalFileAccess: false,
      ignoreEmptyParagraphs: false,
      convertImage: mammoth.images.imgElement(async () => ({
        src: "",
        alt: "未解析图片",
      })),
    },
  );
  const $ = load(converted.value);
  const blocks: DocumentBlock[] = [];
  const warnings: DocumentWarning[] = converted.messages.map((m) => ({
    code: "DOCX_CONVERSION_WARNING",
    message: m.message,
  }));
  const headings: string[] = [];
  $("body")
    .children()
    .each((_index, node) => {
      const el = $(node);
      const tag = node.tagName;
      const id = `docx-${blocks.length + 1}`;
      const own: DocumentWarning[] = [];
      const text = el.text().trim();
      const heading = /^h([1-6])$/.exec(tag);
      if (heading) {
        const level = Number(heading[1]);
        headings.length = Math.min(headings.length, level - 1);
        headings[level - 1] = text;
      }
      if (el.find("img").length || tag === "img")
        own.push({
          code: "IMAGE_NOT_PARSED",
          message: "图片内容未解析",
          blockId: id,
        });
      const isTable = tag === "table";
      const table = isTable
        ? el
            .find("tr")
            .map((_i, row) => [
              $(row)
                .children("th,td")
                .map((_j, cell) => $(cell).text().trim())
                .get(),
            ])
            .get()
        : undefined;
      if (isTable && el.find("[colspan],[rowspan],table").length)
        own.push({
          code: "TABLE_STRUCTURE_LOSS",
          message: "合并或嵌套表格需人工复核",
          blockId: id,
        });
      if (!text && !own.length) return;
      blocks.push({
        id,
        kind: heading
          ? "heading"
          : isTable
            ? "table"
            : ["ul", "ol"].includes(tag)
              ? "list"
              : tag === "img"
                ? "image"
                : "paragraph",
        text,
        headingPath: headings.filter(Boolean),
        anchor: { label: `${isTable ? "表格" : "段落"} ${blocks.length + 1}` },
        ...(table ? { table } : {}),
        warnings: own,
      });
      warnings.push(...own);
    });
  const skipped = parts.filter((name) =>
    /^word\/(?:header\d*|footer\d*|comments\d*)\.xml$/.test(name),
  );
  if (skipped.length) {
    const id = "docx-side-parts";
    const warning = {
      code: "DOCX_SIDE_PARTS_NOT_PARSED",
      message: `页眉、页脚或批注未进入正文解析：${skipped.join("、")}`,
      blockId: id,
    };
    warnings.push(warning);
    blocks.push({
      id,
      kind: "unknown",
      text: "",
      headingPath: [],
      anchor: { label: "未解析的附属内容" },
      warnings: [warning],
    });
  }
  if (blocks.reduce((n, b) => n + b.text.length, 0) > 2000000)
    throw new AppError("DOCUMENT_TEXT_LIMIT", "文档文本超过 2,000,000 字符");
  if (!blocks.some((block) => block.text.trim()))
    warnings.push({ code: "DOCUMENT_NO_TEXT", message: "文档没有可读取文本" });
  return { blocks, warnings, parserVersion: "mammoth-1.13.0/blocks-1" };
}
