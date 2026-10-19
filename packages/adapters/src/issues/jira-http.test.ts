import { expect, it } from "vitest";
import { JiraHttpAdapter } from "./jira-http";
import type { IssueScope } from "../../../contracts/src/issues";
it("scopes password-auth Jira reads and rejects foreign keys before sending credentials", async () => {
  const scope: IssueScope = {
    projectId: "p",
    enabled: true,
    binding: {
      id: "b",
      connectionId: "c",
      platform: "jira-dc",
      instanceUrl: "https://jira.example",
      projectKey: "A",
      owner: "alice",
      issueTypeIds: ["1"],
    },
    connection: {
      id: "c",
      kind: "jira-http",
      platform: "jira-dc",
      name: "Jira",
      username: "alice",
      baseUrl: "https://jira.example",
      credentialRef: null,
      bypassProxy: true,
    },
  };
  const calls: string[] = [];
  const request: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Basic " + Buffer.from("alice:password").toString("base64"),
    );
    if (url.includes("/myself")) return Response.json({ name: "alice" });
    return Response.json({
      startAt: 0,
      total: 1,
      issues: [
        {
          id: "1",
          key: "A-1",
          self: "https://jira.example/rest/api/2/issue/1",
          fields: {
            project: { key: "A" },
            assignee: { name: "alice" },
            issuetype: { id: "1" },
            summary: "bug",
            description: "details",
            status: { name: "Open" },
            updated: "2026-10-19",
          },
        },
      ],
    });
  };
  const adapter = new JiraHttpAdapter(async () => "password", request);
  await expect(
    adapter.get(scope, "OTHER-1", new AbortController().signal),
  ).rejects.toMatchObject({ code: "ISSUE_OUT_OF_SCOPE" });
  expect(calls).toHaveLength(0);
  expect(await adapter.list(scope, new AbortController().signal)).toHaveLength(
    1,
  );
  const query = new URL(calls.at(-1)!).searchParams.get("jql");
  expect(query).toContain('project = "A" AND assignee = "alice"');
});
