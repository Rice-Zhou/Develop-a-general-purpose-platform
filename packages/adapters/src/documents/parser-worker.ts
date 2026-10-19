import { parseDocx } from "./docx-parser";
import { parsePdf } from "./pdf-parser";
import { parseFeishu } from "../feishu/block-parser";
import { z } from "zod";
const input = z
  .object({
    kind: z.enum(["docx", "pdf", "feishu"]),
    bytes: z.string().max(72 * 1024 * 1024),
  })
  .strict();
let text = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (part: string) => {
  text += part;
  if (text.length > 72 * 1024 * 1024) process.exit(2);
});
process.stdin.on("end", () => {
  void (async () => {
    try {
      const request = input.parse(JSON.parse(text));
      const bytes = Buffer.from(request.bytes, "base64");
      const parsed =
        request.kind === "docx"
          ? await parseDocx(bytes)
          : request.kind === "pdf"
            ? await parsePdf(bytes)
            : parseFeishu(JSON.parse(bytes.toString("utf8")));
      process.stdout.write(JSON.stringify(parsed));
    } catch (error) {
      console.error(error instanceof Error ? error.name : "ParseError");
      process.exitCode = 1;
    }
  })();
});
