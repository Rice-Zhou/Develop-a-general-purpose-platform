import { expect, it } from "vitest";
import { jiraQuery } from "./jira-format";
import { issueFixture } from "../../../core/src/issues/issue-test-fixture";

it("never sends possibly nonexistent status names to Jira and indexes every non-completed status", async () => {
  const f = issueFixture();
  const query = jiraQuery(f.service.scope("p", "j"));
  expect(query).toContain('project = "A"');
  expect(query).toContain('assignee = "alice"');
  expect(query).not.toContain("status");
  f.rows.get("j")!.push({ ...f.remote(f.connections[0], 2), status: "已完成" });
  f.rows.get("j")!.push({ ...f.remote(f.connections[0], 3), status: "待验收" });
  const results = await f.service.refresh("p", "j", undefined, new AbortController().signal);
  expect(results.map(r => r.status)).toEqual(["分析中", "待验收"]);
});
