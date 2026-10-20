import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
test("delayed local Jira detection never overwrites Trinity input", async () => {
  const data = await mkdtemp(join(tmpdir(), "platform-delayed-jira-"));
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    const executablePath = process.env.PLATFORM_EXECUTABLE;
    app = await electron.launch({
      ...(executablePath ? { executablePath, args: [] } : { args: ["."] }),
      env: {
        ...process.env,
        PLATFORM_DATA_DIR: data,
        PLATFORM_E2E: "1",
        USERPROFILE: data,
        HOME: data,
      },
    });
    await app.evaluate(({ ipcMain }) => {
      const handlers = (
        ipcMain as unknown as {
          _invokeHandlers: Map<
            string,
            (event: unknown, input: unknown) => unknown
          >;
        }
      )._invokeHandlers;
      const original = handlers.get("platform:request")!;
      ipcMain.removeHandler("platform:request");
      ipcMain.handle("platform:request", (event, input) => {
        if (input.method === "inspectLocalJira")
          return new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  ok: true,
                  value: {
                    available: true,
                    executable: "D:/jira.exe",
                    configFile: "D:/jira.yml",
                    baseUrl: "https://jira.example",
                    username: "jira-user",
                    platform: "jira-dc",
                    detail: "ready",
                  },
                }),
              1500,
            ),
          );
        return original(event, input);
      });
    });
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByLabel("BUG 平台").selectOption("trinity");
    await page
      .getByLabel("平台地址", { exact: true })
      .fill("https://trinity.example/trinity");
    await page.getByLabel("登录账号", { exact: true }).fill("trinity-user");
    await page.getByLabel("登录密码", { exact: true }).fill("not-submitted");
    await expect(
      page.getByRole("button", { name: "登录并保存平台连接", exact: true }),
    ).toBeEnabled();
    await expect(page.getByLabel("平台地址", { exact: true })).toHaveValue(
      "https://trinity.example/trinity",
    );
    await expect(page.getByLabel("登录账号", { exact: true })).toHaveValue(
      "trinity-user",
    );
  } finally {
    await app?.close();
    await rm(data, { recursive: true, force: true });
  }
});
test("missing local CLI offers Jira and Trinity account login and never exposes credentials", async () => {
  const data = await mkdtemp(join(tmpdir(), "platform-logins-"));
  let jiraLogins = 0;
  let trinityLogins = 0;
  const server = createServer(async (req, res) => {
    if (req.url === "/") {
      res.end("<script src=static/js/app.js></script>");
      return;
    }
    if (req.url === "/static/js/app.js") {
      res.end(
        'a=r.enc.Utf8.parse("0123456789abcdef"),b=r.enc.Utf8.parse("fedcba9876543210");function x(t){return r.AES.encrypt(t,a)}',
      );
      return;
    }
    res.setHeader("content-type", "application/json");
    if(req.url==="/rest/api/2/project"){res.end(JSON.stringify([{key:"A",name:"Project A"}]));return;}
    if(req.url==="/rest/api/2/issuetype"){res.end(JSON.stringify([{id:"1",name:"Bug"}]));return;}
    if(req.url==="/trinity/sys/user/userinfo"){res.end(JSON.stringify({code:200,data:{uid:"uid-alice",apiVersion:"v7",isGray:false}}));return;}
    if (req.url === "/rest/api/2/myself") {
      jiraLogins++;
      expect(req.headers.authorization).toBe(
        "Basic " + Buffer.from("alice:fixture-password").toString("base64"),
      );
      res.end(JSON.stringify({ name: "alice" }));
      return;
    }
    if (req.url === "/trinity/security/login/ldap") {
      trinityLogins++;
      let text = "";
      for await (const part of req) text += part;
      expect(text).not.toContain("fixture-password");
      expect(new URLSearchParams(text).get("uid")).toBe("alice");
      res.end(
        JSON.stringify({ code: 200, data: { token: "fixture-session-token" } }),
      );
      return;
    }
    res.statusCode = 404;
    res.end("{}");
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
        PLATFORM_DATA_DIR: data,
        PLATFORM_E2E: "1",
        USERPROFILE: data,
        HOME: data,
      },
    });
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await expect(page.getByLabel("Jira 登录方式")).toHaveValue("account");
    await page.getByLabel("平台地址", { exact: true }).fill(base);
    await page.getByLabel("登录账号", { exact: true }).fill("alice");
    await page.getByLabel("登录密码", { exact: true }).fill("fixture-password");
    await page.getByRole("button",{name:"登录并读取 Jira 项目",exact:true}).click();
    const picker=page.getByRole("combobox",{name:"Jira 项目",exact:true});await expect(picker).toBeEnabled();await picker.fill("A");await page.getByRole("option",{name:"Project A（A）",exact:true}).click();
    await page.getByRole("button",{name:"保存 Jira 连接",exact:true}).click();
    await expect(page.getByText("Jira 连接及对应项目已保存，可直接关联代码项目。",{exact:true})).toBeVisible();
    await expect(page.getByLabel("登录密码", { exact: true })).toHaveValue("");
    await page.getByLabel("BUG 平台").selectOption("trinity");
    await page.getByLabel("平台地址", { exact: true }).fill(base + "/trinity");
    await page.getByLabel("登录账号", { exact: true }).fill("alice");
    await page.getByLabel("登录密码", { exact: true }).fill("fixture-password");
    await page
      .getByRole("button", { name: "登录并保存平台连接", exact: true })
      .click();
    await expect(
      page.getByText("Trinity", { exact: true }).last(),
    ).toBeVisible();
    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const r = await window.platform.getIssueConnections();
          if (!r.ok) throw new Error(r.error.message);
          return r.value.length;
        }),
      )
      .toBe(2);
    const publicData = await page.evaluate(async () =>
      JSON.stringify(await window.platform.getIssueConnections()),
    );
    expect(publicData).not.toMatch(
      /fixture-password|fixture-session-token|credentialRef/,
    );
    expect(jiraLogins).toBe(2);
    expect(trinityLogins).toBe(1);
    expect(
      (await readFile(join(data, "platform.db"))).includes(
        Buffer.from("fixture-password"),
      ),
    ).toBe(false);
  } finally {
    await app?.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(data, { recursive: true, force: true });
  }
});
