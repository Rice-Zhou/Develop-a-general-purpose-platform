import { expect, it } from "vitest";
import { JiraCliAdapter } from "./jira-cli";
import { TrinityAdapter } from "./trinity";
import type { IssueScope } from "../../../contracts/src/issues";
const scope: IssueScope = {
  projectId: "p",
  enabled: true,
  binding: {
    id: "b",
    platform: "jira-dc",
    instanceUrl: "https://jira.example",
    projectKey: "A",
    owner: 'alice" OR project IS NOT EMPTY',
    connectionId: "c",
    issueTypeIds: ["1"],
  },
  connection: {
    id: "c",
    kind: "jira-cli",
    platform: "jira-dc",
    name: "Jira",
    baseUrl: "https://jira.example",
    executable: "D:/jira.exe",
    configFile: "D:/jira.yml",
    bypassProxy: false,
    credentialRef: null,
  },
};
function raw(owner = scope.binding.owner, project = "A") {
  return {
    id: "1",
    key: "A-1",
    self: "https://jira.example/rest/api/2/issue/1",
    fields: {
      project: { key: project },
      assignee: { name: owner },
      issuetype: { id: "1" },
      summary: "密码为空仍可登录",
      description: "password is empty",
      status: { name: "Open" },
      updated: "2026-10-19",
      versions: [],
      comment: { comments: [], total: 0 },
      attachment: [],
    },
  };
}
it("uses bounded read-only Jira CLI queries and validates every returned issue", async () => {
  const calls: string[][] = [];
  const run = async (_exe: string, args: string[]) => {
    calls.push(args);
    if (args[0] === "serverinfo") return "Deployment Type: Server\n";
    if (args[1] === "view") return JSON.stringify(raw());
    return args.includes("0:100") ? JSON.stringify([raw()]) : "[]";
  };
  const adapter = new JiraCliAdapter(
    process.cwd(),
    run,
    async () => "https://jira.example",
  );
  const issues = await adapter.list(scope, new AbortController().signal);
  expect(issues).toHaveLength(1);
  expect(calls[1]).toContain("--raw");
  expect(calls[1]).toContain("--project");
  expect(calls[1][calls[1].indexOf("--jql") + 1]).not.toMatch(/ORDER BY/i);
  expect(calls[1]).toContain("--order-by");
  expect(calls[1]).toContain("--reverse");
  expect(calls[1][calls[1].indexOf("--jql") + 1]).toContain(
    'assignee = "alice\\" OR project IS NOT EMPTY"',
  );
  expect(calls[3]).toContain("1:100");
  await expect(
    new JiraCliAdapter(
      process.cwd(),
      async (_e, a) =>
        a[0] === "serverinfo"
          ? "Deployment Type: Server"
          : a[1] === "view"
            ? JSON.stringify(raw("bob"))
            : JSON.stringify([raw("bob")]),
      async () => "https://jira.example",
    ).list(scope, new AbortController().signal),
  ).rejects.toMatchObject({ code: "ISSUE_OUT_OF_SCOPE" });
  await expect(
    new JiraCliAdapter(
      process.cwd(),
      async () => "Base URL: https://wrong.example",
      async () => "https://wrong.example",
    ).list(scope, new AbortController().signal),
  ).rejects.toMatchObject({ code: "CLI_INSTANCE_MISMATCH" });
});
it("rejects a known out-of-project Jira key before running any CLI command", async () => {
  let calls = 0;
  await expect(
    new JiraCliAdapter(process.cwd(), async () => {
      calls++;
      return "https://jira.example";
    }).get(scope, "OTHER-2", new AbortController().signal),
  ).rejects.toMatchObject({ code: "ISSUE_OUT_OF_SCOPE" });
  expect(calls).toBe(0);
});
it("rejects repeated pages rather than publishing a partial Jira list", async () => {
  await expect(
    new JiraCliAdapter(
      process.cwd(),
      async (_e, a) =>
        a[0] === "serverinfo"
          ? "Deployment Type: Server"
          : a[1] === "view"
            ? JSON.stringify(raw())
            : JSON.stringify([raw()]),
      async () => "https://jira.example",
    ).list(scope, new AbortController().signal),
  ).rejects.toMatchObject({ code: "ISSUE_PAGINATION_INVALID" });
});
it("Trinity never calls an unproven all-account list and rejects business and scope errors", async () => {
  const trinity: IssueScope = {
    ...scope,
    binding: { ...scope.binding, platform: "trinity", issueTypeIds: ["BUG"] },
    connection: {
      id: "c",
      kind: "trinity",
      platform: "trinity",
      name: "T",
      baseUrl: "https://jira.example",
      bypassProxy: false,
      credentialRef: "ref",
    },
  };
  const calls: string[] = [];
  const adapter = new TrinityAdapter(
    async () => "token",
    async (url) => {
      calls.push(String(url));
      return new Response(
        JSON.stringify({
          code: 200,
          data: {
            id: "1",
            bugId: "A-1",
            projectId: "A",
            assigneeId: scope.binding.owner,
            title: "Bug",
            description: "repro",
            status: "Open",
            updateTime: "now",
          },
        }),
      );
    },
  );
  await expect(adapter.list()).rejects.toMatchObject({
    code: "TRINITY_LIST_UNVERIFIED",
  });
  expect(calls).toHaveLength(0);
  expect(
    (await adapter.get(trinity, "A-1", new AbortController().signal)).key,
  ).toBe("A-1");
  expect(calls[0]).toContain("/quality/bugRedux/getByBugId?bugId=A-1");
  await expect(
    new TrinityAdapter(
      async () => "token",
      async () => new Response(JSON.stringify({ code: 401, msg: "sensitive" })),
    ).get(trinity, "A-1", new AbortController().signal),
  ).rejects.toMatchObject({ code: "ISSUE_REMOTE_FAILED" });
});
