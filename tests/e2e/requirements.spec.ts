import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gitFixture, git } from "../../packages/testkit/src/git-fixture";
test("desktop reads real documents, versions requirements and validates a report through the configured API", async () => {
  test.setTimeout(120000);
  const f = await gitFixture();
  const data = await mkdtemp(join(tmpdir(), "requirements-desktop-"));
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  let auditMissing=false;
  const server = createServer(async (req, res) => {
    if(req.method === "HEAD"){res.writeHead(405).end();return;}

    let text = "";
    for await (const part of req) text += part;
    const body = JSON.parse(text) as {
      messages: { role: string; content: string }[];
    };
    const input = JSON.parse(
      body.messages.find((m) => m.role === "user")!.content,
    ) as {
      goal: string;
      materials: {
        blocks: { text: string; evidence: { id: string } }[];
        paths: { bindingId: string; path: string }[];
      };
      input: { id: string }[];
    };
    let message: unknown;
    if (input.goal.startsWith("提取"))
      message = {
        content: JSON.stringify({
          items: [
            {
              text: "用户必须输入密码后才能登录",
              acceptanceCriteria: ["密码为空时拒绝登录"],
              sourceEvidenceIds: [
                input.materials.blocks.find((b) => b.text.includes("用户必须"))!
                  .evidence.id,
              ],
              clarification: "",
            },
          ],
        }),
      };
    else {
      const tool = body.messages
        .slice()
        .reverse()
        .find((m) => m.role === "tool");
      if (!tool) {
        const path = input.materials.paths.find(
          (p) => p.path === "feature.txt",
        )!;
        message = {
          content: null,
          tool_calls: [
            {
              id: "read-login",
              type: "function",
              function: {
                name: "readCode",
                arguments: JSON.stringify({
                  ...path,
                  startLine: 1,
                  endLine: 10,
                }),
              },
            },
          ],
        };
      } else {
        const evidence = JSON.parse(tool.content).evidence as { id: string };
        message = {
          content: JSON.stringify({
            findings: input.input.map((item) => ({
              requirementId: item.id,
              status: auditMissing?"MISSING":"IMPLEMENTED",
              explanation: "空密码被条件分支拒绝；静态代码依据可定位",
              evidenceIds: [evidence.id],
            })),
          }),
        };
      }
    }
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [{ message }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await f.publish(
      "export function login(password) { if (!password) return false; return true; }\n",
    );
    git(f.analysis,"pull","--rebase");
    const executablePath = process.env.PLATFORM_EXECUTABLE;
    app = await electron.launch({
      ...(executablePath ? { executablePath, args: [] } : { args: ["."] }),
      env: {
        ...process.env,
        USERPROFILE: data,
        HOME: data,
        PLATFORM_DATA_DIR: data,
      },
    });
    const page = await app.firstWindow();
    await expect(
      page.getByRole("heading", { name: "研发工作台" }),
    ).toBeVisible();
    const address = server.address() as { port: number };
    await page.evaluate(
      async (input) => {
        const profile = await window.platform.saveAIProfile(
          {
            name: "本地契约服务器",
            kind: "api",
            baseUrl: input.url,
            model: "fixture-model",
            outboundEnabled: true,
          },
          "test-secret-token",
        );
        if (!profile.ok) throw new Error(profile.error.message);
        if ("credentialRef" in profile.value)
          throw new Error("credential reference exposed");
        const project = await window.platform.saveProject({
          name: "需求项目",
          enabled: true,
          repositories: [
            {
              path: input.path,
              branch: "main",
              remoteName: "origin",
              role: "主仓库",
            },
          ],
          documents: [
            {
              id: crypto.randomUUID(),
              kind: "docx",
              locator: input.docx,
              required: true,
            },
            {
              id: crypto.randomUUID(),
              kind: "pdf",
              locator: input.pdf,
              required: true,
            },
          ],
          issueBindings: [],
          aiProfileId: profile.value.id,
        });
        if (!project.ok) throw new Error(project.error.message);
      },
      {
        url: `http://127.0.0.1:${address.port}/v1`,
        path: f.analysis,
        docx: resolve("packages/testkit/fixtures/documents/requirements.docx"),
        pdf: resolve("packages/testkit/fixtures/documents/requirements.pdf"),
      },
    );
    await page.getByRole("button", { name: "需求核对", exact: true }).click();
    await page.getByText("原文准备与独立提取（可选）",{exact:true}).click();
    await page
      .getByRole("button", { name: "准备文档上下文", exact: true })
      .click();
    await expect(page.getByText("原文、人工修订与报告历史",{exact:true})).toBeVisible({timeout:40000});
    await page.getByText("原文、人工修订与报告历史",{exact:true}).click();
    await expect(
      page.getByText("用户必须输入密码后才能登录。", { exact: true }).first(),
    ).toBeVisible({ timeout: 40000 });
    await page
      .getByRole("button", { name: "AI 提取需求", exact: true })
      .click();
    await expect(page.getByLabel("需求描述 1")).toHaveValue(
      "用户必须输入密码后才能登录",
      { timeout: 40000 },
    );
    await page.getByLabel("需求描述 1").fill("登录前必须验证密码");
    await page
      .getByRole("button", { name: "保存需求版本", exact: true })
      .click();
    await expect(page.getByText("需求版本 2", { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "开始实现核对", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "查看报告", exact: true }).first(),
    ).toBeVisible({ timeout: 40000 });
    await page.getByLabel("需求描述 1").fill("修改后的另一条需求");
    await page
      .getByRole("button", { name: "保存需求版本", exact: true })
      .click();
    await expect(page.getByText("需求版本 3", { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "查看报告", exact: true })
      .first()
      .click();
    await expect(
      page.getByRole("heading", { name: "登录前必须验证密码", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "修改后的另一条需求", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("已实现", { exact: true }).first(),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "阅读代码证据", exact: true })
      .first()
      .click();
    await expect(page.getByText(/export function login/).first()).toBeVisible();
    await page.screenshot({ path: "test-results/requirements-report.png" });
    await page.getByRole("button",{name:"返回需求工作台",exact:true}).click();auditMissing=true;
    await page.getByRole("button",{name:"AI 审核当前代码",exact:true}).click();
    await expect.poll(async()=>page.evaluate(async()=>{const r=await window.platform.listTasks();if(!r.ok)throw new Error(r.error.message);const t=r.value.find(t=>t.kind==="AUDIT_REQUIREMENTS");if(t&&["FAILED","WAITING_INPUT"].includes(t.status))throw new Error(JSON.stringify(t.error));return t?.status;}),{timeout:40000}).toBe("SUCCEEDED");
    await page.getByRole("radio",{name:"误报",exact:true}).check();
    await expect(page.getByText("没有待确认或未完成的需求",{exact:true})).toBeVisible();
    const reviews=await page.evaluate(async()=>{const p=await window.platform.listProjects();if(!p.ok)throw new Error(p.error.message);const r=await window.platform.getRequirementReviews(p.value[0].id);if(!r.ok)throw new Error(r.error.message);return r.value;});expect(reviews).toHaveLength(1);expect(reviews[0].state).toBe("FALSE_POSITIVE");

  } finally {
    if (app) await app.close();
    server.close();
    await once(server, "close");
    await f.dispose();
    await rm(data, { recursive: true, force: true });
  }
});
