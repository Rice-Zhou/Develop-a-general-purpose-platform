import { expect, it } from "vitest";
import { parseFeishu } from "./block-parser";
import { FeishuCliSource } from "./document-source";
it("retains block anchors and makes unsupported images visible", () => {
  const p = parseFeishu({
    ok: true,
    data: {
      document: {
        document_id: "doc",
        revision_id: 2,
        content:
          '<title>需求</title><p block-id="b1">登录必须校验密码</p><image block-id="b2"/>',
        reference_map: {},
      },
    },
  });
  expect(p.blocks.some((b) => b.anchor.blockId === "b1")).toBe(true);
  expect(p.warnings.map((w) => w.code)).toContain("IMAGE_NOT_PARSED");
});
it("uses a read-only CLI command and rejects partial or unstable captures", async () => {
  const commands: string[][] = [];
  const payload = {
    ok: true,
    data: {
      document: {
        document_id: "doc",
        revision_id: 2,
        content: '<p block-id="b">text</p>',
        reference_map: {},
      },
    },
  };
  const source = new FeishuCliSource(
    () => ({ larkExecutable: "D:/tools/lark-cli.exe", identity: "user" }),
    async (_exe, args) => {
      commands.push(args);
      return JSON.stringify(payload);
    },
  );
  const capture = await source.fetch(
    {
      id: "d",
      kind: "feishu",
      locator: "https://example.feishu.cn/docx/Token123",
      required: true,
    },
    new AbortController().signal,
  );
  expect(capture.revision).toBe("2");
  expect(commands).toHaveLength(2);
  expect(commands[0].slice(0, 2)).toEqual(["docs", "+fetch"]);
  expect(commands[0]).not.toContain("+update");
  await expect(
    source.fetch(
      {
        id: "d",
        kind: "feishu",
        locator: "https://evil.invalid/docx/token",
        required: true,
      },
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: "FEISHU_URL_DENIED" });
  const partial = new FeishuCliSource(
    () => ({ larkExecutable: "D:/tools/lark-cli.exe", identity: "user" }),
    async () =>
      JSON.stringify({
        ...payload,
        data: { document: { ...payload.data.document, has_more: true } },
      }),
  );
  await expect(
    partial.fetch(
      {
        id: "d",
        kind: "feishu",
        locator: "https://example.feishu.cn/docx/Token123",
        required: true,
      },
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: "FEISHU_PARTIAL" });
});
