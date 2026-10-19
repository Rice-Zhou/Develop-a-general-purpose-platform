import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gitFixture } from "../../packages/testkit/src/git-fixture";
test("scoped Jira CLI intake updates code and reports evidence; transferred Trinity input cannot succeed", async () => {
  test.setTimeout(120000);
  const f = await gitFixture();
  const data = await mkdtemp(join(tmpdir(), "bug-desktop-"));
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  let transferred = false;
  const server = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url?.startsWith("/trinity/quality/bugRedux/getByBugId")) {
      expect(req.headers["x-token"]).toBe("Bearer fixture-token");
      res.end(
        JSON.stringify({
          code: 200,
          data: {
            id: "2",
            bugId: "T-1",
            projectId: "T",
            assigneeId: transferred ? "bob" : "alice",
            title: "Trinity test bug",
            description: "empty password",
            status: "Open",
            updateTime: "2026-10-19",
          },
        }),
      );
      return;
    }
    let text = "";
    for await (const part of req) text += part;
    const body = JSON.parse(text) as {
      messages: { role: string; content: string }[];
    };
    const input = JSON.parse(
      body.messages.find((m) => m.role === "user")!.content,
    );
    const tool = body.messages.find((m) => m.role === "tool");
    let message: unknown;
    if (!tool) {
      const path = input.materials.paths.find(
        (p: { path: string }) => p.path === "feature.txt",
      );
      message = {
        content: null,
        tool_calls: [
          {
            id: "code",
            type: "function",
            function: {
              name: "readCode",
              arguments: JSON.stringify({ ...path, startLine: 1, endLine: 10 }),
            },
          },
        ],
      };
    } else {
      const result = JSON.parse(tool.content);
      expect(result.text).toContain("login");
      if (input.input.issue.key === "T-1") transferred = true;
      message = {
        content: JSON.stringify({
          reproduction: ["空密码登录"],
          facts: [
            {
              text: "登录函数直接返回 true",
              evidenceIds: [result.evidence.id],
            },
          ],
          hypotheses: [
            {
              text: "可能缺少密码校验",
              supportEvidenceIds: [result.evidence.id],
              counterEvidenceIds: [],
              nextSteps: ["复测空密码并记录结果"],
            },
          ],
          missingInformation: ["故障版本提交"],
        }),
      };
    }
    res.end(
      JSON.stringify({
        choices: [{ message }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const commit = await f.publish(
      "export function login(password) { return true; }\n",
    );
    const exe = join(data, "jira-fixture.exe");
    execFileSync(
      join(
        process.env.SystemRoot ?? "C:/Windows",
        "Microsoft.NET/Framework64/v4.0.30319/csc.exe",
      ),
      [
        "/nologo",
        `/out:${exe}`,
        resolve("packages/testkit/fixtures/issues/JiraFixture.cs"),
      ],
      { windowsHide: true, stdio: "pipe" },
    );
    await writeFile(join(data, "host.txt"), base);
    await writeFile(
      join(data, "issue.json"),
      JSON.stringify({
        id: "1",
        key: "A-1",
        self: `${base}/rest/api/2/issue/1`,
        fields: {
          project: { key: "A" },
          assignee: { name: "alice" },
          issuetype: { id: "1" },
          summary: "Jira test bug",
          description: "Empty password accepted",
          status: { name: "Open" },
          updated: "2026-10-19",
          versions: [{ name: "old-build" }],
          comment: { total: 0, comments: [] },
          attachment: [],
        },
      }),
    );
    const executablePath = process.env.PLATFORM_EXECUTABLE;
    app = await electron.launch({
      ...(executablePath ? { executablePath, args: [] } : { args: ["."] }),
      env: { ...process.env, PLATFORM_DATA_DIR: join(data, "app") },
    });
    const page = await app.firstWindow();
    await expect(
      page.getByRole("heading", { name: "研发工作台" }),
    ).toBeVisible();
    const ids = await page.evaluate(
      async (input) => {
        function take<T>(
          r: { ok: true; value: T } | { ok: false; error: { message: string } },
        ): T {
          if (!r.ok) throw new Error(r.error.message);
          return r.value;
        }
        const ai = take(
          await window.platform.saveAIProfile({
            kind: "api",
            name: "fixture",
            baseUrl: input.base + "/v1",
            model: "fixture",
            outboundEnabled: true,
          }),
        );
        const jira = take(
          await window.platform.saveIssueConnection({
            kind: "jira-cli",
            platform: "jira-dc",
            name: "fixture Jira",
            baseUrl: input.base,
            executable: input.exe,
            configFile: input.config,
            bypassProxy: false,
          }),
        );
        const trinity = take(
          await window.platform.saveIssueConnection(
            {
              kind: "trinity",
              platform: "trinity",
              name: "fixture Trinity",
              baseUrl: input.base + "/trinity",
              bypassProxy: false,
            },
            "fixture-token",
          ),
        );
        if ("credentialRef" in trinity)
          throw new Error("private reference leaked");
        const j = crypto.randomUUID(),
          t = crypto.randomUUID();
        const project = take(
          await window.platform.saveProject({
            name: "BUG 项目",
            enabled: true,
            repositories: [
              {
                path: input.repo,
                branch: "main",
                remoteName: "origin",
                role: "main",
              },
            ],
            documents: [],
            aiProfileId: ai.id,
            issueBindings: [
              {
                id: j,
                platform: "jira-dc",
                instanceUrl: input.base,
                projectKey: "A",
                owner: "alice",
                connectionId: jira.id,
                issueTypeIds: ["1"],
              },
              {
                id: t,
                platform: "trinity",
                instanceUrl: input.base + "/trinity",
                projectKey: "T",
                owner: "alice",
                connectionId: trinity.id,
                issueTypeIds: ["BUG"],
              },
            ],
          }),
        );
        return { projectId: project.id, j, t };
      },
      { base, exe, config: join(data, "host.txt"), repo: f.analysis },
    );
    await page.getByRole("button", { name: "BUG 工作台", exact: true }).click();
    await page
      .getByRole("button", { name: "读取项目 BUG", exact: true })
      .first()
      .click();
    await expect(
      page.getByRole("heading", { name: "A-1 · Jira test bug" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "更新代码并预分析", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "查看 BUG 报告", exact: true }),
    ).toBeVisible({ timeout: 40000 });
    await page
      .getByRole("button", { name: "查看 BUG 报告", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "BUG 预分析报告" }),
    ).toBeVisible();
    await expect(page.getByText(commit, { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "阅读 BUG 证据", exact: true })
      .click();
    await expect(page.getByText(/export function login/)).toBeVisible();
    await page.screenshot({ path: "test-results/bug-report.png" });
    await page
      .getByRole("button", { name: "返回 BUG 工作台", exact: true })
      .click();
    await page.getByLabel(`BUG 编号 ${ids.t}`).fill("T-1");
    await page
      .getByRole("button", { name: "按编号读取", exact: true })
      .nth(1)
      .click();
    await expect(
      page.getByRole("heading", { name: "T-1 · Trinity test bug" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "更新代码并预分析", exact: true })
      .nth(1)
      .click();
    await expect(page.getByText(/ISSUE_OUT_OF_SCOPE/)).toBeVisible({
      timeout: 40000,
    });
    expect(
      await page
        .getByRole("button", { name: "查看 BUG 报告", exact: true })
        .count(),
    ).toBe(1);
    const calls = await readFile(join(data, "calls.txt"), "utf8");
    expect(calls).toContain("--project A");
    expect(calls).not.toContain("transition");
  } finally {
    if (app) await app.close();
    server.close();
    await once(server, "close");
    await f.dispose();
    await rm(data, { recursive: true, force: true });
  }
});
