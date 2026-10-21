import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { DeleteAIProfileDialog } from "./DeleteAIProfileDialog";
import type { PublicAIProfile } from "../../../../../packages/contracts/src/analysis";
import type { Project } from "../../../../../packages/contracts/src/models";

it("lists affected projects and requires an explicit replacement or unlink choice", () => {
  const profiles: PublicAIProfile[] = ["old", "other"].map(id => ({ id, name: id, kind: "api", baseUrl: "https://example.com", model: "fixture", outboundEnabled: false, hasCredential: false }));
  const projects = [{ id: "project", name: "受影响项目甲", usesDefaultAI: true }] as Project[];
  const html = renderToStaticMarkup(createElement(DeleteAIProfileDialog, { profile: profiles[0], profiles, projects, isDefault: true, onClose() {}, onDeleted: async () => {} }));
  expect(html).toContain("受影响项目甲");
  expect(html).toContain("继承默认 AI");
  expect(html).toContain("解除关联（未配置）");
  expect(html).toContain('value="other"');
  expect(html).not.toContain('value="old"');
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>确认删除/);
  expect(html).toContain("先取消");
});
