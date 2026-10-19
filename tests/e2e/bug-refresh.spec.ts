import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gitFixture } from "../../packages/testkit/src/git-fixture";

test("refreshes selected Jira project, distinguishes empty and failed refresh, and links issue keys", async () => {
  const data = await mkdtemp(join(tmpdir(), "bug-refresh-"));
  const fixture = await gitFixture();
  let mode: "issues" | "empty" | "failure" = "issues";
  const queries: string[] = [];
  const server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    const url = new URL(req.url!, "http://localhost");
    if (url.pathname === "/rest/api/2/myself") {
      res.end(JSON.stringify({ name: "alice" }));
      return;
    }
    if (url.pathname === "/rest/api/2/project") { res.end(JSON.stringify([{ key: "A", name: "Project A" }])); return; }
    if (url.pathname === "/rest/api/2/issuetype") { res.end(JSON.stringify([{ id: "1", name: "Bug" }])); return; }
    if (url.pathname !== "/rest/api/2/search") {
      res.writeHead(404).end("{}");
      return;
    }
    const jql = url.searchParams.get("jql")!;
    queries.push(jql);
    if (mode === "failure") {
      res.writeHead(503).end("{}");
      return;
    }
    const project = jql.includes('"A"') ? "A" : "B";
    const issues =
      mode === "empty"
        ? []
        : [
            {
              id: project === "A" ? "1" : "2",
              key: project + "-1",
              self: `http://127.0.0.1:${(server.address() as { port: number }).port}/rest/api/2/issue/${project}-1`,
              fields: {
                project: { key: project },
                assignee: { name: "alice" },
                issuetype: { id: "1" },
                summary: project + " scoped bug",
                description: "fixture",
                status: { name: "分析中" },
                updated: "2026-10-19",
                versions: [],
                comment: { total: 0, comments: [] },
                attachment: [],
              },
            },
          ];
    if (issues.length) issues.push({ ...issues[0], id: "completed", key: project + "-2", fields: { ...issues[0].fields, status: { name: "已完成" } } });
    res.end(JSON.stringify({ startAt: 0, total: issues.length, issues }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    const executablePath = process.env.PLATFORM_EXECUTABLE;
    app = await electron.launch({
      ...(executablePath ? { executablePath, args: [] } : { args: ["."] }),
      env: {
        ...process.env,
        USERPROFILE: data,
        HOME: data,
        PLATFORM_DATA_DIR: join(data, "app"),
      },
    });
    const page = await app.firstWindow();
    await page.evaluate(
      async ({ base, repo }) => {
        function take<T>(
          r: { ok: true; value: T } | { ok: false; error: { message: string } },
        ): T {
          if (!r.ok) throw new Error(r.error.message);
          return r.value;
        }
        const connection = take(
          await window.platform.saveIssueConnection(
            {
              kind: "jira-http",
              platform: "jira-dc",
              name: "fixture",
              baseUrl: base,
              username: "alice",
              bypassProxy: false,
            },
            "fixture-password",
          ),
        );
        take(
          await window.platform.saveProject({
            name: "刷新测试",
            enabled: true,
            repositories: [
              {
                path: repo,
                branch: "main",
                remoteName: "origin",
                role: "main",
              },
            ],
            documents: [],
            aiProfileId: null,
            issueBindings: ["A"].map((key) => ({
              id: crypto.randomUUID(),
              platform: "jira-dc" as const,
              instanceUrl: base,
              projectKey: key,
              owner: "alice",
              connectionId: connection.id,
              issueTypeIds: ["1"],
            })),
          }),
        );
      },
      { base, repo: fixture.analysis },
    );
    await app.evaluate(({ ipcMain, shell }) => {
      const captured = globalThis as unknown as { openedIssueUrls: string[] };
      captured.openedIssueUrls = [];
      shell.openExternal = async (url) => {
        captured.openedIssueUrls.push(url);
      };
      const handlers = (
        ipcMain as unknown as {
          _invokeHandlers: Map<
            string,
            (event: unknown, input: unknown) => unknown
          >;
        }
      )._invokeHandlers;
      const original = handlers.get("platform:request")!;
      let loads = 0;
      ipcMain.removeHandler("platform:request");
      ipcMain.handle("platform:request", async (event, input) => {
        const result = (await original(event, input)) as {
          ok: boolean;
          value?: { reports: unknown[] };
        };
        if (input.method === "getBugWorkspace" && result.ok && result.value) {
          const value = {
            ...result,
            value: {
              ...result.value,
              reports: [
                {
                  id: "11111111-1111-4111-8111-111111111111",
                  projectId: input.params.projectId,
                  createdAt: "2026-10-19T00:00:00Z",
                },
              ],
            },
          };
          if (++loads === 1)
            await new Promise((resolve) => setTimeout(resolve, 2000));
          return value;
        }
        return result;
      });
    });
    await page.getByRole("button", { name: "BUG 工作台", exact: true }).click();
    const refresh = page.getByRole("button", {
      name: "刷新问题单",
      exact: true,
    });
    await expect(refresh).toBeVisible();
    await expect(
      page.getByText("尚未刷新当前配置范围；缓存仅代表上次读取的材料。", {
        exact: true,
      }),
    ).toBeVisible();
    await refresh.click();
    await expect(
      page.getByRole("link", { name: "A-1", exact: true }),
    ).toHaveAttribute("href", base + "/browse/A-1");
    await expect(page.getByRole("link", { name: "B-1", exact: true })).toHaveCount(0);
    const analyze = page.getByRole("button", { name: "更新代码并预分析", exact: true });
    await expect(analyze).toBeDisabled();
    await expect(analyze).toHaveAttribute("title", "预分析不可用：当前项目未关联 AI 执行连接，请先配置并关联。");
    await expect(page.getByText("预分析不可用：当前项目未关联 AI 执行连接，请先配置并关联。", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "A-2", exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "查看 BUG 报告", exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "A-1", exact: true }).click();
    await expect
      .poll(() =>
        app!.evaluate(
          () =>
            (globalThis as unknown as { openedIssueUrls: string[] })
              .openedIssueUrls,
        ),
      )
      .toEqual([base + "/browse/A-1"]);
    const denied = await page.evaluate(async () => {
      const projects = await window.platform.listProjects();
      if (!projects.ok) throw new Error(projects.error.message);
      const workspace = await window.platform.getBugWorkspace(
        projects.value[0].id,
      );
      if (!workspace.ok) throw new Error(workspace.error.message);
      return window.platform.openIssue(
        "22222222-2222-4222-8222-222222222222",
        workspace.value.issues[0].id,
      );
    });
    expect(denied.ok).toBe(false);
    expect(queries).toHaveLength(1);
    for (const query of queries) {
      expect(query).toContain('assignee = "alice"');
      expect(query).toContain('project = "A"');
      expect(query).toContain('issuetype in ("1")');
      expect(query).toContain('status in ("修复中","分析中","分配中")');
    }
    mode = "empty";
    await refresh.click();
    await expect(
      page.getByText("当前配置项目及负责人范围内无任何问题", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "A-1", exact: true }),
    ).toHaveCount(0);
    mode = "failure";
    await refresh.click();
    await expect(page.getByRole("alert")).toContainText("Jira HTTP 503");
    await expect(
      page.getByText("当前配置项目及负责人范围内无任何问题", { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText(/刷新失败；.*缓存/).first()).toBeVisible();
    await page.getByRole("button", { name: "关联 AI 连接", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "编辑项目", exact: true });
    await expect(editor.getByLabel("AI 执行连接")).toBeVisible();
    await editor.getByRole("button", { name: "取消", exact: true }).click();
    await page.getByRole("button", { name: "配置 AI 连接", exact: true }).click();
    await expect(page.getByRole("heading", { name: "模型 API 与账号订阅工具" })).toBeInViewport();
    await expect(page.locator("#ai-connections-settings")).toBeFocused();
  } finally {
    await app?.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fixture.dispose();
    await rm(data, { recursive: true, force: true });
  }
});
