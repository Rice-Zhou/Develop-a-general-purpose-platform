import { expect, it } from "vitest";
import { TrinityAdapter } from "./trinity";
import type { IssueScope } from "../../../contracts/src/issues";

const scope: IssueScope = {
  projectId: "code", enabled: true,
  binding: { id: "b", connectionId: "c", platform: "trinity", instanceUrl: "https://trinity.example/trinity", projectKey: "*", owner: "alice", scopeMode: "account", issueTypeIds: ["BUG"] },
  connection: { id: "c", credentialRef: null, kind: "trinity", platform: "trinity", name: "T", baseUrl: "https://trinity.example/trinity", accountId: "alice", bypassProxy: true },
};
const detail = {
  id: "1", bugId: "BUG-1", projectId: "REMOTE", assigneeId: "alice", title: "Bug", status: "analysis", workitemId: "W-1",
  condition: "<p>设备启动</p>", activities: "<p>打开空调<br>切换模式</p>", expectedResult: "<p>正常显示</p>", actualResult: "<p>显示异常</p><script>private-script</script>",
  causeAnalysis: null, solvedScheme: null, modifyTime: "2026-10-20 20:30:00",
};

it("filters on the server with SINGLEUSER EQ and normalizes the observed structured detail contract", async () => {
  const adapter = new TrinityAdapter(async () => "token", async (url, init) => {
    if (String(url).endsWith("userinfo")) return Response.json({ code: 200, data: { apiVersion: "Trinity V8.16.0", isGray: null } });
    expect(new Headers(init?.headers).get("isGray")).toBe("null");
    if (String(url).includes("getBugsByMultiProjects")) {
      const body = JSON.parse(init!.body as string);
      const rule = body.bugReduxCustomConditionsQueryBO?.conditions?.[0];
      if (rule?.field !== "assigneeId" || rule?.operation !== "EQ" || rule?.type !== "SINGLEUSER" || rule?.values?.[0] !== "alice") {
        return Response.json({ code: 200, data: { total: 150427, records: [{ bugId: "OTHER-1" }] } });
      }
      expect(body.mode).toBeUndefined(); expect(body.userId).toBeUndefined();
      expect(body).toMatchObject({ allProjects: true, projectIds: [], pageNum: 1, pageSize: 100 });
      return Response.json({ code: 200, data: { total: 1, current: 1, size: 100, pages: 1, records: [{ bugId: detail.bugId }] } });
    }
    return Response.json({ code: 200, data: detail });
  });
  const [issue] = await adapter.list(scope, new AbortController().signal);
  expect(issue).toMatchObject({ key: "BUG-1", ownerId: "alice", remoteProjectId: "REMOTE", updatedAt: detail.modifyTime, workitemId: "W-1" });
  expect(issue.description).toContain("前置条件：\n设备启动");
  expect(issue.description).toContain("操作步骤：\n打开空调\n切换模式");
  expect(issue.description).toContain("预期结果：\n正常显示");
  expect(issue.description).toContain("实际结果：\n显示异常");
  expect(issue.description).not.toMatch(/<|private-script/);
});

it.each([
  [{ code: 50012, data: null, msg: "private-token" }, "ISSUE_LOGIN_FAILED", "50012"],
  [{ code: 999, data: null, msg: "private-token" }, "ISSUE_REMOTE_FAILED", "999"],
  [{ code: 200, data: { total: "1", records: [] } }, "ISSUE_REMOTE_FAILED", "total"],
  [{ code: 200, data: { total: 150427, records: [] } }, "ISSUE_QUERY_TOO_BROAD", "10000"],
])("distinguishes business, contract and scope-budget failures: %j", async (raw, code, message) => {
  let detailReads = 0;
  const adapter = new TrinityAdapter(async () => "token", async url => {
    if (String(url).endsWith("userinfo")) return Response.json({ code: 200, data: { apiVersion: "v8", isGray: null } });
    if (!String(url).includes("getBugsByMultiProjects")) detailReads++;
    return Response.json(raw);
  });
  await expect(adapter.list(scope, new AbortController().signal)).rejects.toMatchObject({ code, message: expect.stringContaining(message) });
  expect(detailReads).toBe(0);
});

it("still rejects transferred issues and missing real modification timestamps", async () => {
  let value: Record<string, unknown> = { ...detail, assigneeId: "bob" };
  const adapter = new TrinityAdapter(async () => "token", async url => Response.json(String(url).endsWith("userinfo") ? { code: 200, data: { apiVersion: "v8", isGray: null } } : { code: 200, data: value }));
  await expect(adapter.get(scope, "BUG-1", new AbortController().signal)).rejects.toMatchObject({ code: "ISSUE_OUT_OF_SCOPE" });
  value = { ...detail, modifyTime: undefined };
  await expect(adapter.get(scope, "BUG-1", new AbortController().signal)).rejects.toMatchObject({ code: "ISSUE_REMOTE_FAILED" });
});

it("preserves the returned Trinity project name while keeping the real ID as identity",async()=>{
 const adapter=new TrinityAdapter(async()=>"token",async url=>Response.json(String(url).endsWith("userinfo")?{code:200,data:{apiVersion:"v8",isGray:null}}:{code:200,data:{...detail,projectName:"E0V_26款_SCDC_8295_国际左舵"}}));
 expect(await adapter.get(scope,"BUG-1",new AbortController().signal)).toMatchObject({remoteProjectId:"REMOTE",remoteProjectName:"E0V_26款_SCDC_8295_国际左舵"});
});
