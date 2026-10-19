import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Tray,
  shell,
} from "electron";
import { join, resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { loginTrinity } from "../../../../packages/adapters/src/issues/login";
import { JiraHttpAdapter } from "../../../../packages/adapters/src/issues/jira-http";
import { createCredentialStore } from "./credential-store";
import type { AIProfile } from "../../../../packages/contracts/src/analysis";
import type { IssueConnection } from "../../../../packages/contracts/src/issues";
import {
  assertTrustedSender,
  parseRequest,
} from "../../../../packages/contracts/src/ipc";
import { AppError, errorData } from "../../../../packages/contracts/src/error";
import { ServiceClient } from "./service-client";
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let service: ServiceClient;
let exiting = false;
let mayExit = false;
if (process.env.PLATFORM_DATA_DIR)
  app.setPath("userData", resolve(process.env.PLATFORM_DATA_DIR));
else if (!app.isPackaged)
  app.setPath(
    "userData",
    join(app.getPath("appData"), "local-dev-platform-development"),
  );
const single = app.requestSingleInstanceLock();
if (!single) app.quit();
else {
  app.on("second-instance", () => {
    window?.show();
    window?.focus();
  });
  void app
    .whenReady()
    .then(async () => {
      const credentials = createCredentialStore(app.getPath("userData"));
      service = new ServiceClient(
        app.getPath("userData"),
        app.getVersion(),
        credentials,
      );
      window = new BrowserWindow({
        title: "本地研发辅助平台",
        width: 1360,
        height: 900,
        minWidth: 1000,
        minHeight: 700,
        backgroundColor: "#f4f6fa",
        autoHideMenuBar: true,
        webPreferences: {
          preload: join(__dirname, "preload.cjs"),
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
        },
      });
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.on("will-navigate", (event) => event.preventDefault());
      window.webContents.session.setPermissionRequestHandler(
        (_contents, _permission, callback) => callback(false),
      );
      window.webContents.session.webRequest.onHeadersReceived(
        (details, callback) =>
          callback({
            responseHeaders: {
              ...details.responseHeaders,
              "Content-Security-Policy": [
                "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://127.0.0.1:*; object-src 'none'; base-uri 'none'",
              ],
            },
          }),
      );
      ipcMain.handle("platform:request", async (event, input: unknown) => {
        try {
          assertTrustedSender(
            event.sender.id,
            window!.webContents.id,
            event.senderFrame === window!.webContents.mainFrame,
          );
          const request = parseRequest(input);
          if (request.method === "openIssue") {
            const result = await service.control(
              "get-issue-url",
              request.params,
            );
            if (!result.ok) return result;
            if (typeof result.value !== "string")
              throw new AppError(
                "ISSUE_LINK_INVALID",
                "无法取得有效的问题单链接",
              );
            await shell.openExternal(result.value);
            return { ok: true, value: undefined };
          }
          if (request.method === "chooseDocumentFiles") {
            const selection = await dialog.showOpenDialog(window!, {
              title: "选择本地需求文档",
              properties: ["openFile", "multiSelections"],
              filters: [{ name: "需求文档", extensions: ["docx", "pdf"] }],
            });
            return {
              ok: true,
              value: selection.canceled ? [] : selection.filePaths,
            };
          }
          if (
            request.method === "saveAIProfile" ||
            request.method === "saveIssueConnection"
          ) {
            const issueConnection = request.method === "saveIssueConnection";
            const id = request.params.id ?? randomUUID();
            let existing: AIProfile | IssueConnection | undefined;
            if (request.params.id) {
              const result = await service.control(
                issueConnection ? "get-issue-connection" : "get-profile",
                { id },
              );
              if (!result.ok) return result;
              existing = result.value as AIProfile | IssueConnection;
            }
            const draft = request.params.draft;
            let secret = request.params.secret;
            if (
              issueConnection &&
              (draft.kind === "jira-http" ||
                (draft.kind === "trinity" && draft.username)) &&
              !secret
            )
              throw new AppError(
                "ISSUE_LOGIN_REQUIRED",
                "请填写账号密码后登录平台",
              );
            if (
              issueConnection &&
              "kind" in draft &&
              draft.kind === "trinity" &&
              draft.username &&
              secret
            )
              secret = await loginTrinity(
                draft.baseUrl,
                draft.username,
                secret,
              );
            if (issueConnection && draft.kind === "jira-http" && secret) {
              await new JiraHttpAdapter(async () => secret!).probe(
                {
                  projectId: id,
                  enabled: true,
                  binding: {
                    id,
                    connectionId: id,
                    platform: draft.platform,
                    instanceUrl: draft.baseUrl,
                    projectKey: "LOGIN",
                    owner: draft.username,
                  },
                  connection: { ...draft, id, credentialRef: null },
                },
                AbortSignal.timeout(30000),
              );
            }
            const keep =
              existing &&
              "baseUrl" in existing &&
              "baseUrl" in draft &&
              existing.kind === draft.kind &&
              existing.baseUrl === draft.baseUrl &&
              (!("username" in draft) ||
                ("username" in existing &&
                  existing.username === draft.username));
            const credentialRef = secret
              ? await credentials.save(id, secret)
              : keep
                ? existing!.credentialRef
                : null;
            const saved = await service.control(
              issueConnection ? "save-issue-connection" : "save-profile",
              {
                id,
                credentialRef,
                draft,
              },
            );
            if (!saved.ok) {
              if (credentialRef && credentialRef !== existing?.credentialRef)
                await credentials.remove(credentialRef);
              return saved;
            }
            if (
              existing?.credentialRef &&
              existing.credentialRef !== credentialRef
            )
              await credentials.remove(existing.credentialRef);
            return saved;
          }
          if (
            request.method === "deleteAIProfile" ||
            request.method === "deleteIssueConnection"
          ) {
            const issueConnection = request.method === "deleteIssueConnection";
            const prior = await service.control(
              issueConnection ? "get-issue-connection" : "get-profile",
              {
                id: request.params.id,
              },
            );
            if (!prior.ok) return prior;
            const removed = await service.control(
              issueConnection ? "delete-issue-connection" : "delete-profile",
              {
                id: request.params.id,
              },
            );
            if (!removed.ok) return removed;
            const ref = (prior.value as AIProfile).credentialRef;
            if (ref) await credentials.remove(ref);
            return removed;
          }
          if (
            request.method === "exportReport" ||
            request.method === "exportBugReport"
          ) {
            const bug = request.method === "exportBugReport";
            const content = await service.control(
              bug ? "export-bug-report" : "export-report",
              request.params,
            );
            if (!content.ok) return content;
            const selected = await dialog.showSaveDialog(window!, {
              title: bug ? "导出 BUG 预分析报告" : "导出需求核对报告",
              defaultPath: `${bug ? "bug" : "requirement"}-report-${request.params.reportId}.md`,
              filters: [{ name: "Markdown", extensions: ["md"] }],
            });
            if (selected.canceled || !selected.filePath)
              return { ok: true, value: null };
            await writeFile(selected.filePath, String(content.value), "utf8");
            return { ok: true, value: selected.filePath };
          }
          if (request.method === "chooseRepositoryDirectory") {
            const result = await dialog.showOpenDialog(window!, {
              properties: ["openDirectory"],
              title: "选择独立代码分析目录",
            });
            return {
              ok: true,
              value: result.canceled ? null : result.filePaths[0],
            };
          }
          if (request.method === "backupDatabase") {
            const result = await dialog.showSaveDialog(window!, {
              title: "备份本地数据库",
              defaultPath: `platform-backup-${Date.now()}.db`,
              filters: [{ name: "SQLite", extensions: ["db"] }],
            });
            return result.canceled || !result.filePath
              ? { ok: true, value: null }
              : service.backup(result.filePath);
          }
          return await service.request(request);
        } catch (error) {
          return { ok: false, error: errorData(error) };
        }
      });
      const iconPath = join(__dirname, "../renderer/main_window/icon.png");
      const icon = nativeImage.createFromPath(iconPath);
      if (!icon.isEmpty()) {
        tray = new Tray(icon);
        tray.setToolTip("本地研发辅助平台");
        tray.setContextMenu(
          Menu.buildFromTemplate([
            { label: "打开研发工作台", click: () => window?.show() },
            { type: "separator" },
            { label: "退出", click: () => app.quit() },
          ]),
        );
        tray.on("double-click", () => window?.show());
      }
      window.on("close", (event) => {
        if (!exiting && tray) {
          event.preventDefault();
          window?.hide();
        }
      });
      if (MAIN_WINDOW_VITE_DEV_SERVER_URL)
        await window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
      else
        await window.loadFile(
          join(__dirname, "../renderer/main_window/index.html"),
        );
    })
    .catch((error) => {
      dialog.showErrorBox(
        "启动失败",
        error instanceof Error ? error.message : String(error),
      );
      app.exit(1);
    });
  app.on("before-quit", (event) => {
    if (mayExit) return;
    event.preventDefault();
    if (exiting) return;
    exiting = true;
    void (async () => {
      try {
        await service?.stop();
        mayExit = true;
        tray?.destroy();
        app.quit();
      } catch (error) {
        exiting = false;
        window?.show();
        dialog.showErrorBox(
          "退出尚未完成",
          error instanceof Error ? error.message : String(error),
        );
      }
    })();
  });
}
