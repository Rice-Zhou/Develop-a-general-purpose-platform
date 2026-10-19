import { expect, it } from "vitest";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { JiraHttpAdapter } from "./jira-http";
import { JiraCliAdapter } from "./jira-cli";
import { runProcess } from "../process/run-process";
import type { IssueConnection } from "../../../contracts/src/issues";

const connection: IssueConnection = {
  id: "c", kind: "jira-http", platform: "jira-dc", name: "fixture",
  baseUrl: "https://jira.example", username: "alice", credentialRef: null,
  bypassProxy: true,
};
it("does not mistake a CLI Cloud login email for an accountId", async () => {
  const adapter = new JiraCliAdapter("D:/fixture", async () => { throw new Error("must not run"); });
  await expect(adapter.discover({ ...connection, kind: "jira-cli", platform: "jira-cloud", executable: "D:/jira.exe", configFile: "D:/jira.yml" }, new AbortController().signal)).rejects.toMatchObject({ code: "CLI_IDENTITY_UNSUPPORTED" });
});
it("discovers authenticated account and all accessible project names without a project scope", async () => {
  let fail = false;
  const request: typeof fetch = async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/myself")) return Response.json({ name: "alice", displayName: "Alice" });
    if (fail) return new Response("secret failure", { status: 403 });
    if (path.endsWith("/project")) return Response.json([{ id: "10", key: "A", name: "Project A" }, { id: "20", key: "B", name: "Project B" }]);
    return Response.json([{ id: "1", name: "Bug", subtask: false }, { id: "2", name: "Task", subtask: false }]);
  };
  const adapter = new JiraHttpAdapter(async () => "fixture", request);
  const result = await adapter.discover(connection, new AbortController().signal);
  expect(result.owner).toBe("alice");
  expect(result.projects.map((p) => [p.key, p.name])).toEqual([["A", "Project A"], ["B", "Project B"]]);
  expect(result.issueTypes).toEqual([{ id: "1", name: "Bug" }, { id: "2", name: "Task" }]);
  fail = true;
  await expect(adapter.discover(connection, new AbortController().signal)).rejects.toMatchObject({ code: "ISSUE_REMOTE_FAILED" });
});
it.runIf(Boolean(process.env.PLATFORM_TEST_JIRA_CLI))("native Jira CLI discovers projects and reads named types from its local configuration", async () => {
  const root = await mkdtemp(join(tmpdir(), "jira-discovery-"));
  let base = "";
  let empty = false;
  let noAssigned = false;
  let transferred = false;
  const queries: string[] = [];
  const server = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url?.includes("serverInfo")) res.end(JSON.stringify({ deploymentType: "Server", version: "9.0.0", baseUrl: base }));
    else if (req.url?.includes("/project")) res.end(JSON.stringify(empty ? [] : [{ id: "10", key: "A", name: "Project A", projectTypeKey: "software" }, { id: "20", key: "B", name: "项目 B", projectTypeKey: "business" }]));
    else if (req.url?.includes("/search")) {
      let body = ""; for await (const part of req) body += part;
      const jql = body ? JSON.parse(body).jql : new URL(req.url, base).searchParams.get("jql");
      queries.push(jql);
      const issues = noAssigned || jql.includes('assignee = "bob"') ? [] : [{ id: "1", key: "A-1", fields: { summary: "fixture", assignee: { name: "alice", displayName: "Alice" } } }];
      res.end(JSON.stringify({ startAt: 0, total: issues.length, maxResults: 1, issues }));
    }
    else if (req.url?.includes("/issue/A-1")) res.end(JSON.stringify({ key: "A-1", fields: { assignee: { name: transferred ? "bob" : "alice" } } }));
    else { res.statusCode = 404; res.end("{}"); }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const configFile = join(root, "jira.yml");
  await writeFile(configFile, `installation: Local\nserver: ${base}\nlogin: bob\nproject:\n  key: A\n  type: classic\nissue:\n  types:\n    - id: "1"\n      name: Bug\n      subtask: false\n`);
  const run: typeof runProcess = async (exe, args, options) => { const output = await runProcess(exe, args, { ...options, env: { ...options.env, JIRA_API_TOKEN: "fixture", JIRA_AUTH_TYPE: "basic", HOME: root, USERPROFILE: root } }); return output; };
  try {
    const adapter = new JiraCliAdapter(root, run);
    const result = await adapter.discover({ ...connection, kind: "jira-cli", platform: "jira-dc", baseUrl: base, executable: process.env.PLATFORM_TEST_JIRA_CLI!, configFile }, new AbortController().signal);
    expect(result.owner).toBe("alice");
    expect(result.projects.map((p) => [p.key, p.name])).toEqual([["A", "Project A"], ["B", "项目 B"]]);
    expect(result.issueTypes).toEqual([{ id: "1", name: "Bug" }]);
    expect(queries.every((jql) => jql.includes("assignee = currentUser()"))).toBe(true);
    expect(queries.every((jql) => jql.includes("project IS NOT EMPTY") && !/project\s*=/i.test(jql))).toBe(true);
    empty = true;
    expect((await adapter.discover({ ...connection, kind: "jira-cli", platform: "jira-dc", baseUrl: base, executable: process.env.PLATFORM_TEST_JIRA_CLI!, configFile }, new AbortController().signal)).projects).toEqual([]);
    empty = false; noAssigned = true;
    await expect(adapter.discover({ ...connection, kind: "jira-cli", platform: "jira-dc", baseUrl: base, executable: process.env.PLATFORM_TEST_JIRA_CLI!, configFile }, new AbortController().signal)).rejects.toMatchObject({ code: "CLI_IDENTITY_UNVERIFIED" });
    noAssigned = false; transferred = true;
    await expect(adapter.discover({ ...connection, kind: "jira-cli", platform: "jira-dc", baseUrl: base, executable: process.env.PLATFORM_TEST_JIRA_CLI!, configFile }, new AbortController().signal)).rejects.toMatchObject({ code: "CLI_IDENTITY_UNVERIFIED" });
  } finally {
    server.close(); await once(server, "close");
    await rm(root, { recursive: true, force: true });
  }
});
