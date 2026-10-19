import { expect, it } from "vitest";
import { issueFixture } from "./issue-test-fixture";

it("keeps both platforms and links in one workspace while isolating a broken source", async () => {
  const f = issueFixture();
  const signal = new AbortController().signal;
  for (const b of f.project.issueBindings) await f.service.refresh("p", b.id, undefined, signal);
  const workspace = f.service.workspace("p");
  expect(workspace.issues).toHaveLength(2);
  expect(workspace.issues[0].webUrl).toBe("https://jira.example/browse/A-1");
  expect(workspace.issues[1].webUrl).toContain("https://trinity.example/#/bug/newBugDetail?");
  f.project.issueBindings[1].connectionId = "missing";
  const partial = f.service.workspace("p");
  expect(partial.issues.map(i => i.connectionId)).toEqual(["j"]);
  expect(partial.sources[1].error?.code).toBe("ISSUE_NOT_CONFIGURED");
});

it("reading one issue supplements its source batch without replacing other issues or platforms", async () => {
  const f = issueFixture();
  f.rows.get("j")!.push(f.remote(f.connections[0], 2));
  const signal = new AbortController().signal;
  for (const b of f.project.issueBindings) await f.service.refresh("p", b.id, undefined, signal);
  await f.service.refresh("p", "j", "A-1", signal);
  expect(f.service.workspace("p").issues.map(i => `${i.connectionId}:${i.key}`)).toEqual(["j:A-2", "j:A-1", "t:A-1"]);
});
