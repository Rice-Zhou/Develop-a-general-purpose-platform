# GitHub 客户端在线更新 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 1.0.1 提供启动一次的新版本提示、设置中手动检查、经校验的下载及安全安装交接。

**Architecture:** GitHub 适配器读取唯一公开仓库的正式 Release，主进程 UpdateService 拥有更新状态及缓存；工作服务中共享一个 WorkGate 原子冻结任务入口，复用现有 shutdown。独立安装交接 helper 等待原客户端退出，再启动校验过的 Squirrel 安装器。渲染器不能指定 URL、exe 或 helper 路径。

**Tech Stack:** Electron、TypeScript、Undici、Node crypto/fs/child_process、Zod、Vitest、Playwright、Forge/Squirrel；将已安装的 semver 7.8.5 声明为直接运行依赖，并锁定兼容的 @types/semver 7.x。

**Spec:** [已认可设计第 6—8 节](../specs/2026-10-21-task-bug-reading-release-update-design.md)。按用户最新指令，交付目标版本为 1.0.1。

## Global Constraints

- 根目录、Node 路径、默认 60000ms 测试超时见总计划。
- 唯一默认仓库为公开 GitHub `Rice-Zhou/Develop-a-general-purpose-platform`；本次不增加 GitLab 实现、不使用 Token、不发布 Release。
- 请求使用既有 fetchDirect；HTTPS 不降级，不关闭 TLS 校验，不使用系统环境代理或 AI 代理。
- 安装版与便携版都使用同一安装包；便携版选择更新时提示“更新后转为安装版，现有配置保留”。
- 更新检查最多 30 秒，下载总时限 20 分钟、无数据超时 30 秒、最大包 1 GiB、最多 5 次重定向；测试用 fake clock，不真实等待超时。
- 本次客户端本身先手动安装/启动一次，此后版本才可由本模块升级。

## Review Focus

- GitHub latest 404 既可能没有 Release，也可能仓库不可见，不能一律当作已是最新（B1）。
- 403、错误 SHA、错误大小、跨源跳转、旧下载晚返回，不得产生 ready 状态（B1/B2）。
- 渲染器刷新、托盘恢复、双窗口同时消费提示，同一进程仍只弹一次启动提示（B2/B4）。
- 在检查空闲和退出之间出现新任务、晚返回的附件发现，不得创建新活动任务（B3）。
- 安装器/交接 helper 启动失败或父进程未退出，不能误报更新成功或重复安装（B3）。

### B1：Release 契约与 GitHub 来源适配

**Files:** Create `packages/contracts/src/updates.ts`、`packages/adapters/src/updates/github-release.ts`、`github-release.test.ts`；Modify `package.json`、`package-lock.json`。Provider 接口定义在 updates.ts，不提供未使用的第二实现。

**Interfaces:** `UpdateManifest={schemaVersion:1;version:string;platform:"win32";arch:"x64";assetName:"LocalDevPlatformSetup.exe";size:number;sha256:string}`。`UpdateOffer={id:string;version:string;releaseUrl:string;notes:string;manifest:UpdateManifest;assetUrl:string}`。`ReleaseCheck={kind:"current";version:string}|{kind:"no-release"}|{kind:"available";offer:UpdateOffer}`。`ReleaseProvider.check(currentVersion:string,signal:AbortSignal):Promise<ReleaseCheck>`。GitHubReleaseProvider 构造注入 HTTP transport 和固定 repo，生产使用 fetchDirect。

- [ ] 写失败测试 `formal_release_and_consistent_manifest_produces_offer`、`tag_manifest_package_version_mismatch_is_rejected`、`draft_prerelease_and_non_upgrade_are_not_offered`、`latest_404_checks_repository_visibility`、`forbidden_is_not_no_update`。
- [ ] 运行 `node node_modules/vitest/vitest.mjs run packages/adapters/src/updates/github-release.test.ts`，确认新实现缺失导致失败。
- [ ] 严格解析 GitHub latest、附件及清单；稳定版本允许 tag 的单个 v 前缀，清单使用规范 SemVer，拒绝 prerelease。只在正式版本高于当前时下载小清单；latest 404 时查询仓库以区分 NO_RELEASE 与仓库不可见；403 区分限流/访问受限，错误摘要不记录响应正文。
- [ ] 固定附件名及同一 Release，校验 version/platform/arch/size/sha256。只允许仓库 release download 地址及 GitHub 官方附件 CDN 重定向；逐跳 manual 校验，拒绝 HTTP/任意站点/超限跳转。补充恶意清单、错平台、缺附件、超大包、TLS/超时测试，目标测试全绿。
- [ ] 提交 `feat: resolve verified update offers from public GitHub releases`。

### B2：唯一更新状态、一次提示与校验下载

**Files:** Create `apps/desktop/src/main/update-service.ts`、`update-service.test.ts`、`packages/adapters/src/updates/update-download.ts`、`update-download.test.ts`；Modify `packages/contracts/src/updates.ts`。

**Interfaces:** `UpdatePhase="idle"|"checking"|"up-to-date"|"unavailable"|"available"|"downloading"|"ready"|"installing"|"error"`。`UpdateStatus={currentVersion:string;phase:UpdatePhase;offer:UpdateOffer|null;receivedBytes:number;error:ErrorData|null;startupPromptPending:boolean;installationMode:"installed"|"portable"|"development";lastCheckedAt:string|null}`。`UpdateService.getStatus():UpdateStatus`、`check(reason:"startup"|"manual"):Promise<UpdateStatus>`、`takeStartupPrompt():UpdateOffer|null`、`download(offerId:string):Promise<UpdateStatus>`、`cancelDownload():void`。Downloader 接口 `downloadVerified(offer,cacheRoot,signal,onProgress):Promise<VerifiedUpdate>`，`VerifiedUpdate={offerId:string;path:string;size:number;sha256:string}` 只在主进程内部含绝对路径，不跨 preload 暴露。

- [ ] 写失败测试：同一进程 startup check 仅一次、双消费只有一次拿到 offer、暂不更新/托盘恢复不重置；并发检查复用 Promise；未选择前不取安装包。
- [ ] 跑 update-service/update-download 单测，确认新入口缺失导致失败。
- [ ] UpdateService 持有唯一状态与操作代次；旧请求返回不得覆盖新状态。显式下载后流式写 .part，限制大小并计算 SHA-256，通过才原子改名 ready；目录和文件均由主进程生成。校验失败/取消清理临时文件并显示准确状态，不能把残留文件当作已下载。
- [ ] 增加检查/下载并发、取消后晚返回、已 ready 后检查失败、旧 offerId、重命名失败、网络中断、错 Content-Length、实际超预算、哈希不符测试；安装模式只检测真实 Squirrel 布局，不能凭目录名称推断。目标测试通过，类型检查通过。
- [ ] 提交 `feat: manage client update state and verified downloads`。

### B3：原子任务保护、退出及安装交接

**Files:** Create `packages/core/src/runtime/work-gate.ts`、`work-gate.test.ts`，`apps/desktop/src/main/update-install.ts`、`update-install.test.ts`，`apps/desktop/src/main/update-helper.ts`、`update-helper.test.ts`，`vite.update-helper.config.ts`；Modify `TaskService`、`IssueLogService`、`Workbench`、`service.ts`、`service-client.ts`、`main.ts`、`forge.config.ts`，扩展对应队列测试。

**Interfaces:** `WorkGate.assertAccepting():void`、`freezeIfIdle(isBusy:()=>boolean):void`、`release():void`。service.ts 创建唯一 WorkGate，注入 TaskService（第五参数，独立使用时默认新实例）和 IssueLogService（第六参数，独立使用时默认新实例）。Workbench 构造接收该实例并传给 logs。ServiceClient.control 新增 `freeze-for-update` / `release-update-freeze`；freeze 同步设置 gate 后读取真实活动任务，忙则恢复 gate 并抛 UPDATE_TASKS_ACTIVE。`UpdateService.install(offerId:string):Promise<void>` 调用安装协调器。`InstallerHandoff.prepare(request:InstallRequest):Promise<void>` 启动已随应用发布的 helper 并等待 ready；`InstallRequest={offerId:string;targetVersion:string;cacheRoot:string;installerPath:string;expectedSize:number;expectedSha256:string;parentPid:number;previousClientPath:string;resultPath:string}`，所有值由主进程生成；helper 再次检查路径位于缓存内并且字段符合 schema。

- [ ] 写失败测试 `freeze_prevents_analysis_and_log_publication`、`busy_freeze_restores_acceptance`、`late_attachment_discovery_rechecks_gate_before_creating_task`；构造 await 期间插入 freeze 的真实竞争，不只测标志位。
- [ ] 写安装失败测试：旧 offer、缓存替换、活动任务、新任务竞态、worker shutdown 失败、helper 启动失败、父进程退出超时、安装器 spawn 失败；先跑目标测试确认失败。
- [ ] 两个队列在入口及异步准备后的发布点检查同一 WorkGate；所有触发新工作的 IPC/control 调用沿用该门禁，不能建立第二套任务忙状态。无活动任务冻结成功才调用既有 service.stop()；失败时显示错误，不静默杀任务、不假成功。
- [ ] helper 由独立 Vite 构建产出并随 Forge extraResource 放在 resources/update-helper.cjs。主进程以自身 exe+ELECTRON_RUN_AS_NODE 启动，参数数组传递，detached/windowsHide，不拼 Shell 命令；helper ready 后主进程退出，helper 等待父 PID 消失后再复核安装包并 spawn 安装器，原进程仍存在则不安装。spawn 失败写不含凭据的交接结果并重新启动原客户端显示错误；客户端下次启动时读取经过 schema 校验的交接结果，只有运行版本已达到目标版本才显示升级成功；仍是旧版本时显示待完成或交接错误，不将“安装器已启动”显示为“升级成功”。
- [ ] main 在创建窗口/单实例锁/监控之前处理 Squirrel 安装参数；明确 --squirrel-install/updated/uninstall/obsolete 事件不进入普通工作流。更新交接失败且后台已关闭时，只提供重启客户端恢复入口，不继续接收任务；已有 before-quit 只执行一次 stop。
- [ ] 跑 work-gate、安装协调器、helper、TaskService/IssueLogService 目标回归和类型检查；提交 `feat: hand off verified updates after quiescing work safely`。

### B4：受限 IPC、启动提示和设置页更新入口

**Files:** Modify `contracts/models.ts`、`contracts/ipc.ts`、`preload.ts`、`main.ts`、`renderer/App.tsx`；Create `renderer/components/ClientUpdateDialog.tsx`、`renderer/components/ClientUpdateSettings.tsx`、`tests/e2e/client-update.spec.ts`；Modify `renderer/styles.css`。

**Interfaces:** DesktopAPI 增加 `getUpdateStatus():Promise<Result<UpdateStatus>>`、`checkForUpdates():Promise<Result<UpdateStatus>>`、`takeStartupUpdatePrompt():Promise<Result<UpdateOffer|null>>`、`downloadUpdate(offerId:string):Promise<Result<UpdateStatus>>`、`cancelUpdateDownload():Promise<Result<null>>`、`installUpdate(offerId:string):Promise<Result<null>>`、`restartAfterUpdateFailure():Promise<Result<null>>`。IPC 严格空参数或有界 offerId，不接受路径/命令/仓库/URL。restart 只在安装交接失败并停止后台的状态可用。main 负责更新 API，工作服务不处理互联网 Release 检查。

- [ ] 写失败桌面测试：启动新版本提示一次、暂不更新后刷新/托盘恢复不弹；设置手动检查展示可用版/当前最新/403；点击更新前服务器未收到安装包请求。
- [ ] 在 main 注入隔离测试用 ReleaseProvider；E2E 仅在 PLATFORM_E2E=1 时允许本机 loopback 测试 API 地址，生产默认来源不能被 renderer 或任意环境 URL 改写。先验证旧包无 API/界面而失败。
- [ ] 接线严格 IPC，main 启动异步检查一次；renderer 轮询/订阅已有主进程状态，只有 takeStartupUpdatePrompt 真正消费到 offer 才显示启动弹窗；手动检查结果在设置中显示，不重新激活启动提示资格。
- [ ] 下载展示字节与进度、取消与失败；ready 才出现“安装并重启”。便携版显式提示转安装版。忙任务安装失败提供统一任务列表入口；不自动取消任何任务。说明纯文本展示，不渲染远程 HTML。
- [ ] 模拟双检查、页面卸载再挂载、损坏包、取消、忙任务和交接失败；测试只用隔离数据和假安装器端口，不安装到用户真实目录。跑 client-update、task-navigation 及 IPC 单测；提交 `feat: add one-time startup update prompt and settings controls`。

### B5：1.0.1 打包清单、发行素材与最终验收

**Files:** Modify `package.json`、`package-lock.json`、`forge.config.ts`、`README.md`；Create `scripts/generate-update-manifest.ts`、`packages/adapters/src/updates/release-manifest.test.ts`、`docs/1.0.1任务报告与在线更新验收.md`、`docs/公开GitHubRelease发布说明.md`。

**Interfaces:** `generateUpdateManifest({version,installerPath,outputPath}):Promise<UpdateManifest>` 从最终安装器计算实际字节数和 SHA-256，产出 platform-update.json；由 Forge postMake 对本次 squirrel.windows/x64 产物调用，不读取旧版安装器。校验器消费 B1 的同一清单 schema。Release tag 为 v1.0.1，清单版本和 package.json 为 1.0.1。

- [ ] 写失败测试：本次安装器字节变化必须改变 size/sha256；不同版本/旧输出目录不能生成可用的“本次更新”清单；缺安装器、临时文件和空包均失败。
- [ ] 在该任务中将 package.json 和 lock 根版本统一设为 1.0.1，接入 postMake，发布说明列明安装包+清单两个必须附件，并列出可选 ZIP、RELEASES/nupkg。客户端不依赖发布 Token；发布者权限只用于用户之后明确授权的发布操作。
- [ ] 运行新增单测、受影响既有单测、`tsc --noEmit`、`eslint .`。相关后端测试维持 60000ms；失败先定位，不扩大全局超时。
- [ ] 设置 PLATFORM_BUILD_DIR=out/releases/1.0.1 并使用已配置 Electron 缓存执行 `node node_modules/@electron-forge/cli/dist/electron-forge.js make`。完成后才启动该产物的 E2E；测试运行期间禁止 make 同一目录。目标 E2E：task-navigation、bug-report-binding、bug-report-reading、client-update、bug-task-queue、issue-log-download、requirements、ai-delete、codex-discovery、trinity-auto-login。
- [ ] 逐文件校验 ZIP 与便携目录；验证清单实际哈希对应本次 Setup.exe。启动 helper 做不安装任何软件的真实运行时自检；安装交接逻辑通过隔离假安装器验证，实际“旧安装版→新安装版”与公开 Release 联调若未执行，必须写明，不能用 mock 代替。
- [ ] 只读查看当前真实 BUG20261020_14151 的已有报告，确认按 BUG 找到、原因优先及证据原位阅读；不重新发送项目材料。直连查询公开仓库 Release，分别记录 403/无 Release/可用 Release；不为通过测试切换到 AI 代理或上传发行文件。
- [ ] 在验收记录中附产物路径、哈希、单元/桌面验证结果及实际更新边界；检查 diff 是否存在重复队列/报告缓存、默认展开历史、可执行任意路径、未说明的便携模式变化。提交 `release: package task report and update improvements as 1.0.1`。

## 交付与边界

产物入口：`out/releases/1.0.1/本地研发辅助平台-win32-x64/LocalDevPlatform.exe`；安装包及清单位于本次 make/squirrel.windows/x64；ZIP 位于 make/zip/win32/x64。

已有 0.9.3 首次必须手动升级。实际公开仓库仍不可访问或没有发行清单时，客户端应准确显示未就绪；发布安装包到公开 Release 是后续独立授权步骤。本次不改真实账号、AI 连接、代码项目配置或问题单。
