import type {
  DocumentBlock,
  DocumentWarning,
  ParsedDocument,
} from "../../../contracts/src/documents";
import { AppError } from "../../../contracts/src/error";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
export async function parsePdf(bytes: Buffer): Promise<ParsedDocument> {
  const { getDocument, OPS } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // Packaged workers are CommonJS; source tests resolve from the project package.
  const require = createRequire(
    typeof __filename === "string"
      ? __filename
      : join(process.cwd(), "package.json"),
  );
  const resources = dirname(
    require.resolve("pdfjs-dist/package.json"),
  ).replaceAll("\\", "/");
  const loading = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
    disableFontFace: true,
    stopAtErrors: true,
    useWorkerFetch: false,
    standardFontDataUrl: resources + "/standard_fonts/",
    cMapUrl: resources + "/cmaps/",
    cMapPacked: true,
  });
  try {
    const document = await loading.promise;
    if (document.numPages > 1000)
      throw new AppError("DOCUMENT_PAGE_LIMIT", "PDF 超过 1,000 页");
    const blocks: DocumentBlock[] = [];
    const warnings: DocumentWarning[] = [];
    let total = 0;
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      const items = content.items.filter(
        (item): item is import("pdfjs-dist/types/src/display/api").TextItem =>
          "str" in item,
      );
      const text = items
        .map((item) => item.str + (item.hasEOL ? "\n" : " "))
        .join("")
        .trim();
      const id = `pdf-page-${number}`;
      const operations = await page.getOperatorList();
      const imageOperations = new Set([
        OPS.paintImageXObject,
        OPS.paintImageMaskXObject,
        OPS.paintImageMaskXObjectGroup,
        OPS.paintInlineImageXObject,
        OPS.paintInlineImageXObjectGroup,
        OPS.paintImageXObjectRepeat,
        OPS.paintImageMaskXObjectRepeat,
      ]);
      if (operations.fnArray.some((op) => imageOperations.has(op)))
        warnings.push({
          code: "IMAGE_NOT_PARSED",
          message: `第 ${number} 页包含未进行视觉解析的图片`,
          blockId: id,
        });
      if (!text)
        warnings.push({
          code: "PDF_NO_TEXT",
          message: `第 ${number} 页无文本，可能为空白页或扫描件`,
          blockId: id,
        });
      if (text.includes("\uFFFD"))
        warnings.push({
          code: "PDF_TEXT_GARBLED",
          message: `第 ${number} 页存在无法解码字符`,
          blockId: id,
        });
      total += text.length;
      if (total > 2000000)
        throw new AppError(
          "DOCUMENT_TEXT_LIMIT",
          "PDF 文本超过 2,000,000 字符",
        );
      blocks.push({
        id,
        kind: "paragraph",
        text,
        headingPath: [],
        anchor: {
          label: `第 ${number} 页`,
          page: number,
          coordinates: items
            .flatMap((item) => [
              item.transform[4],
              item.transform[5],
              item.width,
              item.height,
            ])
            .slice(0, 40000),
        },
        warnings: warnings.filter((w) => w.blockId === id),
      });
      page.cleanup();
    }
    return { blocks, warnings, parserVersion: "pdfjs-6.4.299/blocks-1" };
  } finally {
    await loading.destroy();
  }
}
