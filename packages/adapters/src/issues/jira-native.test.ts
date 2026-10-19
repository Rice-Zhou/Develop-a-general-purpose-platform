import { expect, it } from "vitest";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { JiraCliAdapter } from "./jira-cli";
import { runProcess } from "../process/run-process";
import type { IssueScope } from "../../../contracts/src/issues";
it.runIf(Boolean(process.env.PLATFORM_TEST_JIRA_CLI)).each([0, 1, 100, 200])(
  "actual Jira CLI uses one ORDER BY and correctly completes %s results",
  async (size) => {
    const root = await mkdtemp(join(tmpdir(), "jira-native-contract-"));
    const count = size;
    const queries: string[] = [];
    let base = "";
    let observed = "";
    let failPage = false;
    const raw = (n: number) => ({
      id: String(n),
      key: `A-${n}`,
      self: `${base}/rest/api/2/issue/${n}`,
      fields: {
        project: { key: "A" },
        assignee: { name: "alice" },
        issuetype: { id: "1", name: "Bug" },
        summary: "fixture",
        description: "repro",
        status: { name: "Open" },
        updated: "2026-10-19T00:00:00.000+0000",
        versions: [],
        comment: { total: 0, comments: [] },
        attachment: [],
      },
    });
    const server = createServer(async (req, res) => {
      res.setHeader("Content-Type", "application/json");
      if (req.url?.includes("serverInfo")) {
        res.end(
          JSON.stringify({
            baseUrl: base,
            version: "9.0.0",
            deploymentType: "Server",
            serverTitle: "Fixture",
          }),
        );
        return;
      }
      if (req.url?.includes("/issue/A-")) {
        const number = Number(req.url.match(/A-(\d+)/)?.[1]);
        res.end(JSON.stringify(raw(number)));
        return;
      }
      const u = new URL(req.url!, base);
      let payload: Record<string, unknown> = {};
      if (req.method === "POST") {
        let body = "";
        for await (const c of req) body += c;
        payload = JSON.parse(body);
      }
      const jql = String(payload.jql ?? u.searchParams.get("jql") ?? "");
      queries.push(jql);
      if ((jql.match(/ORDER BY/gi) ?? []).length !== 1) {
        res.statusCode = 400;
        res.end(JSON.stringify({ errorMessages: ["Duplicate ordering"] }));
        return;
      }
      const start = Number(
        payload.startAt ?? u.searchParams.get("startAt") ?? 0,
      );
      const limit = Number(
        payload.maxResults ?? u.searchParams.get("maxResults") ?? 100,
      );
      if (failPage && start > 0) {
        res.statusCode = 403;
        res.end(
          JSON.stringify({
            errorMessages: ['No result found for given query in project "A"'],
          }),
        );
        return;
      }
      const issues = Array.from(
        { length: Math.max(0, Math.min(count - start, limit)) },
        (_, i) => raw(start + i + 1),
      );
      res.end(
        JSON.stringify({
          startAt: start,
          maxResults: limit,
          total: count,
          issues,
        }),
      );
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const config = join(root, "fixture.yml");
    await writeFile(
      config,
      `installation: Local\nserver: ${base}\nlogin: alice\nproject:\n  key: A\n  type: classic\n`,
    );
    const scope: IssueScope = {
      projectId: "p",
      enabled: true,
      binding: {
        id: "b",
        platform: "jira-dc",
        instanceUrl: base,
        projectKey: "A",
        owner: "alice",
        connectionId: "c",
        issueTypeIds: ["1"],
      },
      connection: {
        id: "c",
        kind: "jira-cli",
        platform: "jira-dc",
        name: "fixture",
        baseUrl: base,
        executable: process.env.PLATFORM_TEST_JIRA_CLI!,
        configFile: config,
        bypassProxy: true,
        credentialRef: null,
      },
    };
    const run: typeof runProcess = async (exe, args, options) => {
      const env = { ...options.env };
      for (const key of Object.keys(env))
        if (key.startsWith("JIRA_")) delete env[key];
      Object.assign(env, {
        JIRA_API_TOKEN: "fixture-token",
        JIRA_AUTH_TYPE: "basic",
        JIRA_CONFIG_FILE: config,
        HOME: root,
        USERPROFILE: root,
      });
      const result = await runProcess(exe, args, { ...options, env });
      observed += JSON.stringify({ args, stdout: result }) + "\n";
      return result;
    };
    try {
      const adapter = new JiraCliAdapter(root, run);
      expect(
        await adapter.list(scope, new AbortController().signal),
      ).toHaveLength(size);
      expect(
        queries.every(
          (q) =>
            q.includes('project = "A"') && q.includes('assignee = "alice"') &&
            q.includes('status in ("修复中","分析中","分配中")'),
        ),
      ).toBe(true);
      if (size === 1) {
        failPage = true;
        await expect(
          adapter.list(scope, new AbortController().signal),
        ).rejects.toMatchObject({ code: "PROCESS_FAILED" });
      }
    } finally {
      await writeFile(
        join(
          process.cwd(),
          ".superpowers/sdd/issue-milestone/native-observed.log",
        ),
        observed,
      );
      server.close();
      await once(server, "close");
      await rm(root, { recursive: true, force: true });
    }
  },
);
