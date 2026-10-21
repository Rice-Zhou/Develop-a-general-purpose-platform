import {UpdateService} from "./update-service";
import {updateSource} from "./update-source";
import {downloadVerified} from "../../../../packages/adapters/src/updates/update-download";
import {InstallerHandoff,installationMode,installVerifiedUpdate} from "./update-install";
import {verifyInstaller,readHandoffResult,type InstallRequest} from "./update-helper";
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
import { TrinityLogin } from "./trinity-login";
import { JiraCliAdapter } from "../../../../packages/adapters/src/issues/jira-cli";
import { trinityApiUrl } from "../../../../packages/core/src/issues/scope-policy";
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
const squirrelEvent=process.argv.some(arg=>["--squirrel-install","--squirrel-updated","--squirrel-uninstall","--squirrel-obsolete"].includes(arg));
const single = !squirrelEvent && app.requestSingleInstanceLock();
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
      const trinity = new TrinityLogin(credentials, {
        connections: async () => {
          const result = await service.control("get-issue-connections", {});
          if (!result.ok) throw new AppError(result.error.code, result.error.message);
          return result.value as IssueConnection[];
        },
        commit: async (connection) => {
          const {id,credentialRef,passwordRef,...draft}=connection;
          const result=await service.control("save-issue-connection",{id,credentialRef,passwordRef,draft});
          if(!result.ok)throw new AppError(result.error.code,result.error.message);
          return result.value;
        },
      });
      const cacheRoot=join(app.getPath("userData"),"updates");
      const source=updateSource(process.env);
      const updates=new UpdateService(app.getVersion(),source.provider,(offer,root,signal,progress)=>downloadVerified(offer,root,signal,progress,source.transport),cacheRoot,installationMode(process.execPath,app.isPackaged));
      const previousUpdate=await readHandoffResult(join(cacheRoot,"handoff-result.json"),app.getVersion());
      let startup:Promise<void>=Promise.resolve();
      let startupError:unknown;
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
          if(request.method==="getUpdateStatus")return {ok:true,value:updates.getStatus()};
          if(request.method==="checkForUpdates")return {ok:true,value:await updates.check("manual")};
          if(request.method==="takeStartupUpdatePrompt")return {ok:true,value:updates.takeStartupPrompt()};
          if(request.method==="downloadUpdate")return {ok:true,value:await updates.download(request.params.offerId)};
          if(request.method==="cancelUpdateDownload"){updates.cancelDownload();return {ok:true,value:null};}
          if(request.method==="restartAfterUpdateFailure"){
            if(!updates.getStatus().restartRequired)throw new AppError("UPDATE_RESTART_DENIED","当前无需恢复更新后台");app.relaunch();mayExit=true;tray?.destroy();app.exit(0);return {ok:true,value:null};
          }
          if(request.method==="installUpdate"){
            if(process.env.PLATFORM_E2E==="1")throw new AppError("UPDATE_E2E_INSTALL_DISABLED","隔离桌面测试不执行真实安装");
            await updates.install(request.params.offerId,async(offer,verified)=>{
              const handoff:InstallRequest={offerId:offer.id,targetVersion:offer.version,cacheRoot,installerPath:verified.path,expectedSize:verified.size,expectedSha256:verified.sha256,parentPid:process.pid,previousClientPath:process.execPath,resultPath:join(cacheRoot,"handoff-result.json")};
              const control=async()=>{const result=await service.control("freeze-for-update",{});if(!result.ok)throw new AppError(result.error.code,result.error.message);};
              await installVerifiedUpdate(offer,verified,{verify:()=>verifyInstaller(handoff),freeze:control,stop:()=>service.stop(),prepare:()=>new InstallerHandoff(process.execPath,app.isPackaged?join(process.resourcesPath,"update-helper.cjs"):join(__dirname,"update-helper.cjs")).prepare(handoff),markRestartRequired:()=>updates.markRestartRequired(),quit:()=>{mayExit=true;exiting=true;tray?.destroy();app.quit();}});
            });return {ok:true,value:null};
          }
          if(request.method === "getTrinityLoginStatus")return {ok:true,value:trinity.status()};
          await startup;
          if(startupError)throw startupError;
          if(request.method === "openIssueMaterial") {
            const result=await service.control("get-issue-material-path",request.params);
            if(!result.ok)return result;
            if(typeof result.value!=="string")throw new AppError("LOG_DENIED","无法定位附件原件");
            shell.showItemInFolder(result.value);
            return {ok:true,value:undefined};
          }
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
          if (request.method === "discoverJiraConnection") {
            const {draft,secret}=request.params;
            if(draft.kind==="trinity")throw new AppError("ISSUE_CONNECTION_INVALID","请选择 Jira 登录方式");
            if(draft.kind==="jira-http"&&!secret)throw new AppError("ISSUE_LOGIN_REQUIRED","请输入 Jira 登录密码");
            const adapter=draft.kind==="jira-cli"?new JiraCliAdapter(app.getPath("userData")):new JiraHttpAdapter(async()=>secret!);
            return {ok:true,value:await adapter.discover({...draft,id:randomUUID(),credentialRef:null},AbortSignal.timeout(120000))};
          }
          if (
            request.method === "saveAIProfile" ||
            request.method === "saveIssueConnection"
          ) {
            const issueConnection = request.method === "saveIssueConnection";
            let selectedId = request.params.id;
            if(issueConnection && request.params.draft.kind === "trinity" && !selectedId) {
              const current=await service.request({method:"getIssueConnections",params:{}});
              if(!current.ok)return current;
              selectedId=(current.value as IssueConnection[]).find(c=>c.kind==="trinity")?.id;
            }
            const id = selectedId ?? randomUUID();
            let existing: AIProfile | IssueConnection | undefined;
            if (selectedId) {
              const result = await service.control(
                issueConnection ? "get-issue-connection" : "get-profile",
                { id },
              );
              if (!result.ok) return result;
              existing = result.value as AIProfile | IssueConnection;
            }
            let draft = request.params.draft;
            if(issueConnection && draft.kind === "trinity") draft={...draft,baseUrl:trinityApiUrl(draft.baseUrl)};
            const secret = request.params.secret;
            if(issueConnection && draft.kind === "trinity")return {ok:true,value:await trinity.save(draft,secret,existing as IssueConnection|undefined,id)};
            if (
              issueConnection &&
              draft.kind === "jira-http" &&
              !secret
            )
              throw new AppError(
                "ISSUE_LOGIN_REQUIRED",
                "请填写账号密码后登录平台",
              );
            if(issueConnection && (draft.kind === "jira-cli" || draft.kind === "jira-http")) {
              if(!draft.jiraProject)throw new AppError("JIRA_SELECTION_REQUIRED","请先读取并选择此连接对应的 Jira 项目及缺陷类型");
              const adapter=draft.kind==="jira-cli"?new JiraCliAdapter(app.getPath("userData")):new JiraHttpAdapter(async()=>secret!);
              const catalogue=await adapter.discover({...draft,id,credentialRef:null},AbortSignal.timeout(120000));
              const selected=draft.jiraProject;
              const project=catalogue.projects.find(p=>p.key===selected.key);
              if(!project || selected.owner!==catalogue.owner || !selected.issueTypeIds.length || selected.issueTypeIds.some(type=>!catalogue.issueTypes.some(t=>t.id===type))) throw new AppError("JIRA_SELECTION_INVALID","Jira 项目或负责人已变化，请重新读取并选择");
              draft={...draft,jiraProject:{...project,owner:catalogue.owner,issueTypeIds:selected.issueTypeIds}};
            }
            const keep =
              existing &&
              existing.kind === draft.kind &&
              (!issueConnection || ("baseUrl" in existing && "baseUrl" in draft &&
              existing.baseUrl === draft.baseUrl &&
              (!("username" in draft) ||
                ("username" in existing &&
                  existing.username === draft.username))));
            if(issueConnection&&existing&&"passwordRef" in existing&&existing.passwordRef)await credentials.remove(existing.passwordRef);
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
            if(issueConnection&&existing?.kind==="trinity")trinity.forget();
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
            const passwordRef=issueConnection?(prior.value as IssueConnection).passwordRef:null;
            if(passwordRef)await credentials.remove(passwordRef);
            const removed = await service.control(
              issueConnection ? "delete-issue-connection" : "delete-profile",
              {
                ...request.params,
              },
            );
            if (!removed.ok) return removed;
            const ref = (prior.value as AIProfile).credentialRef;
            if (ref) await credentials.remove(ref);
            if(issueConnection&&(prior.value as IssueConnection).kind==="trinity")trinity.forget();
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
      if(process.env.PLATFORM_E2E!=="1"||process.env.PLATFORM_UPDATE_E2E_URL)void updates.check("startup");
      startup=(async()=>{await trinity.startup();await service.startIssueMonitor();})().catch(error=>{startupError=error;});
      if (MAIN_WINDOW_VITE_DEV_SERVER_URL)
        await window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
      else
        await window.loadFile(
          join(__dirname, "../renderer/main_window/index.html"),
        );
      if(previousUpdate)void dialog.showMessageBox(window!,{type:previousUpdate.success?"info":"warning",title:"客户端更新",message:previousUpdate.message});
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
