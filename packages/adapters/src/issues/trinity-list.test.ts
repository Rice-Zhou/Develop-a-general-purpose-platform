import { expect, it } from "vitest";
import { TrinityAdapter } from "./trinity";
import type { IssueScope } from "../../../contracts/src/issues";

const scope: IssueScope = {
  projectId: "p", enabled: true,
  binding: { id: "b", platform: "trinity", instanceUrl: "https://trinity.example/trinity", projectKey: "P", owner: "alice", connectionId: "c", issueTypeIds: ["BUG"] },
  connection: { id: "c", kind: "trinity", platform: "trinity", name: "T", baseUrl: "https://trinity.example/trinity", credentialRef: "ref", bypassProxy: true },
};
it("reads all scoped Trinity pages and validates each detail without querying the account worklist", async () => {
  const bodies: unknown[] = [];
  const adapter = new TrinityAdapter(async () => "token", async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/sys/user/userinfo")) return Response.json({ code: 200, data: { apiVersion: "Trinity V7.5.0", isGray: false } });
    expect(new Headers(init?.headers).get("apiVersion")).toBe("Trinity V7.5.0");
    if (url.pathname.endsWith("/findBugsByProject")) {
      const body = JSON.parse(init!.body as string);
      bodies.push(body);
      return Response.json({ success: true, data: { pageNum: body.pageNum, total: 2, bugs: [{ bugId: `BUG-${body.pageNum}` }] } });
    }
    expect(url.pathname).toBe("/trinity/quality/bugRedux/getByBugId");
    return Response.json({ code: 200, data: { id: url.searchParams.get("bugId"), bugId: url.searchParams.get("bugId"), projectId: "P", assigneeId: "alice", title: "Bug", description: "detail", status: "assigned", updateTime: "now", workitemId: "W" } });
  });
  expect((await adapter.list(scope, new AbortController().signal)).map(i => i.key)).toEqual(["BUG-1", "BUG-2"]);
  expect(bodies).toEqual([1, 2].map(pageNum => ({ projectId: "P", projectIds: ["P"], assignees: ["alice"], pageNum, pageSize: 100 })));
});
it("does not guess an API version or query issues when user protocol metadata is missing", async () => {
  const calls: string[] = [];
  const adapter = new TrinityAdapter(async () => "token", async input => {
    calls.push(String(input));
    return Response.json({ code: 200, data: {} });
  });
  await expect(adapter.list(scope, new AbortController().signal)).rejects.toMatchObject({ code: "TRINITY_PROTOCOL_INVALID" });
  expect(calls).toEqual(["https://trinity.example/trinity/sys/user/userinfo"]);
});
it("fails repeated or incomplete Trinity pagination and never returns a partial list", async () => {
  const adapter = new TrinityAdapter(async () => "token", async (input) => {
    if (String(input).endsWith("/sys/user/userinfo")) return Response.json({ code: 200, data: { apiVersion: "Trinity V7.5.0", isGray: false } });
    if (String(input).endsWith("/findBugsByProject"))
      return Response.json({ success: true, data: { pageNum: 1, total: 2, bugs: [{ bugId: "BUG-1" }] } });
    return Response.json({ code: 200, data: { id: "1", bugId: "BUG-1", projectId: "P", assigneeId: "alice", title: "Bug", description: "detail", status: "assigned", updateTime: "now" } });
  });
  await expect(adapter.list(scope, new AbortController().signal)).rejects.toMatchObject({ code: "ISSUE_PAGINATION_INVALID" });
});
