# BUG 日志、当前代码预分析与 AI 协议自适应实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 问题刷新后准备真实日志，BUG 分析读取包含未提交修改的当前工作区快照，模型 API 与代理统一自动选择 HTTPS/HTTP，并交付经过真实联调的新桌面版本。

**Architecture:** 分为日志材料、工作区快照、AI 地址协议三个可独立验收的子计划，最后整合 BUG 任务。复用现有内容存储、账号连接、项目映射和取证管线；工作区与日志均以不可变内容和来源清单取证。协议探测与模型请求分开，避免重复推理请求。

**Tech Stack:** 现有 Electron、React、TypeScript、Zod、SQLite/better-sqlite3、Node.js Streams、Git CLI、Undici、Windows curl、Vitest、Playwright；新增生产依赖 yauzl 3.4.0 用于按条目流式读取 ZIP，不自行实现解压算法。

**Spec:** [已认可设计](BUG日志与当前代码预分析及AI协议自适应设计.md)。日期 2026-10-21；当前基线 0.7.6，设计提交 5fa6620。状态：用户已认可，任务 1—7 已实现并验证，0.8.0 已打包；任务 8 的真实模型已调用，完整报告仍待修正用户配置的模型 ID 后重试，其余自动验证通过。详见验收文档。

## Global Constraints

- 开发、修改、测试和打包根目录固定为 `D:/development/Develop-a-general-purpose-platform`。执行方式沿用用户此前选择的当前会话直接开发；使用 executing-plans，不主动启动子代理。
- 第三阶段原有附件“仅元信息”限制由本次设计替代，其他 Jira/Trinity 项目及账号隔离、飞书直连行为保持。BUG 预分析不修改问题状态、负责人、评论或业务代码。
- 日志预算：单附件 512 MiB、单问题 2 GiB、并行下载最多 2 个；解包总计 2 GiB、最多 10000 个文件、最多嵌套 2 层。常量集中定义，流式计数实际字节，不只信任 Content-Length。
- BUG 只捕获当前代码，不执行 fetch/pull/rebase/checkout/stash；项目“更新代码”及需求核对既有同步路径不在本次改动范围。未提交修改、暂存修改、可读未跟踪文件和删除结果进入快照。
- 模型 API 与代理各保留一个配置地址，派生 HTTPS/HTTP 候选；只对 AI 应用协议选择，其他网络仍直连。认证、权限、限流、模型业务错误不触发协议降级。
- 凭据不进入 URL、命令行、日志、材料清单或测试夹具。下载、解压、路径和证据边界必须校验。失败可见，不用空数组、截断或通用 catch 伪装成功。
- 新版预定 0.8.0；数据库升级至 9，升级前备份 v8。旧项目、AI 连接 ID、默认关系、Git 提交快照及旧报告必须可读取。
- 每个任务先失败测试、验证失败原因，再实现、验证和提交。后端测试超时 60000 ms。执行中若发现契约不符，先记录阻断，继续不依赖它的任务，不虚构真实下载成功。

## Review Focus

1. 账号轮换、附件更新与旧下载并发：旧响应不得覆盖新版本，也不能跨账号复用未重新验证的材料（任务 1、2、3）。
2. 应用重启、中断或落盘失败：半文件不得标为已下载，引用的原件和工作区内容不得被清理或漏入备份说明（任务 2、4）。
3. 捕获代码时同名文件被替换为链接、文件正在变化、删除后重建：必须报出不一致，不拼成混合快照或读出目录（任务 4）。
4. HTTPS 探测返回 401/405、模型 POST 已发送后断开：协议可达与模型权限分开，不能重复 POST 或回退重发（任务 6、7）。
5. 旧报告的 code 证据与新 worktree-code/log 证据混用：严格按类型分派，不能误用 Git blob、跨上下文或把未读日志算成证据（任务 4、5、8）。

## 文件与接口约定

新建 `packages/contracts/src/issue-materials.ts` 定义日志类型与预算；新建 `packages/contracts/src/ai-address.ts` 定义浏览器可用的纯地址解析。现有 models.ts/analysis.ts/issues.ts 只引用相关类型与 schema，不集中塞入实现。

- `AttachmentDescriptor = {id, name, mediaType, size:number|null, version:string}`；临时签名 URL 和认证信息仅在适配器内部使用，不返回 renderer。
- `IssueLogScope = {platform, instanceUrl, accountId, remoteIssueId}`；与代码 projectId 无关，用于 Trinity 多项目展示去重。每次复用前仍验证当前问题/账号权限。
- `IssueLogSet = {id, scope, issueVersion, generation, status, attachments, files, error}`；status 为 `QUEUED | DOWNLOADING | READY | NO_LOGS | FAILED | UNSUPPORTED`。文件解析状态另为 `PARSED | UNSUPPORTED | FAILED`，不混同下载成功。
- `IssueLogSetRef = {id, manifestHash}`；文件清单保存原附件 ID、包内路径、原件/文本 contentHash、大小、编码、行数及索引覆盖范围。
- `RepositorySnapshot` 成为旧 Git 快照与 `WorktreeRepositorySnapshot` 联合。旧记录缺少 kind 时仍按 Git 快照解释；新快照 kind 为 `worktree`，保存 bindingId、canonicalPath、实际 branch/HEAD、capturedAt、manifestHash、dirty、文件内容哈希与排除项。
- `BugAnalysisOptions = {logPolicy:'required'|'code-only'}`；默认 required。`analyzeBug({projectId, issueSnapshotId, targetProjectId?, options?})` 替代内部位置参数 API；重试沿用原任务显式选项。
- 新增 evidence kind `worktree-code`（manifestHash、文件 contentHash、路径及行范围）和 `log`（logSetId、manifestHash、fileId、contentHash、行范围及片段哈希）；旧 code/document 不改变含义。`isCodeEvidence(ref)` 在 contracts 单一位置判定两种代码证据。
- AI 配置保留 baseUrl/proxyUrl 字段，允许保存去协议后的规范地址，兼容输入完整 URL。`parseAIAddress(input, kind:'api'|'proxy'): {address, httpsUrl, httpUrl}`；`resolveAIEndpoint(address, kind, {proxyUrl?, signal}): Promise<{url, scheme, httpsFailure?}>`；诊断只返回脱敏失败码。

---

## 子计划 A：真实问题日志材料

### Task 1：核实并接通平台附件发现与下载

**Files:** 修改 `packages/core/src/issues/ports.ts`、`packages/adapters/src/issues/jira-cli.ts`、`packages/adapters/src/issues/jira-http.ts`、`packages/adapters/src/issues/trinity.ts`、`packages/adapters/src/issues/trinity-format.ts`、`packages/adapters/src/issues/jira-format.ts`；新增 `packages/adapters/src/issues/attachment-download.ts`、`attachments.test.ts`、`packages/testkit/fixtures/issues/attachments/`（仅脱敏响应）。

**Interfaces:** `IssueAdapter.listAttachments(scope, issue, signal): Promise<AttachmentDescriptor[]>`；`IssueAdapter.downloadAttachment(scope, issue, attachmentId, destination, signal): Promise<{size:number;sha256:string}>`。未验证/不支持发现时抛 `ISSUE_ATTACHMENTS_UNSUPPORTED`，不能返回假空列表。

- [ ] 1. 使用现有账号和已确认目标问题只读核对 Trinity 附件请求；检查已装 Jira CLI 的附件能力及响应。记录实际接口、认证、分页、资源版本和重定向契约，保存脱敏样例；有日志的真实问题才算完成下载联调。
- [ ] 2. 写失败测试 `discovers_then_downloads_verified_attachment`、`distinguishes_verified_empty_from_unsupported`、`rejects_cross_host_credentials_and_stale_owner`；断言下载哈希/字节数正确、认证不跨主机、取消和远端异常可见、CLI 连接不要求另填密码。
- [ ] 3. 运行 `npm test -- packages/adapters/src/issues/attachments.test.ts`，确认因能力缺失失败；再实现上述两个适配器接口与下载边界。大附件不走当前将 stdout/响应正文整体放入内存的 curlFetch。
- [ ] 4. 重跑目标测试及现有 issues 测试，全部通过；使用一次真实附件下载比对大小及哈希，不把模拟成功写成真实成功。
- [ ] 5. 提交本任务；若源平台契约仍不可验证，记录明确阻断并继续子计划 B/C，不完成本任务勾选。

### Task 2：流式内容存储、持久下载队列和 ZIP 解析

**Files:** 新增 `packages/contracts/src/issue-materials.ts`、`packages/core/src/issues/issue-log-service.ts`、`packages/storage/src/issue-material-repository.ts`、`packages/adapters/src/logs/zip-reader.ts`、`packages/adapters/src/logs/text-log-reader.ts`、相邻测试；修改 `packages/storage/src/snapshot-store.ts`、`packages/storage/src/database.ts`、`packages/storage/src/migrations.ts`、`packages/storage/src/migrations.test.ts`、package.json/lock。

**Interfaces:** `SnapshotStore.putStream(source:AsyncIterable<Uint8Array>, {maxBytes,signal}):Promise<{hash,size}>`；`IssueLogService.enqueue(scope,issue):Promise<IssueLogSet>`、`prepare(scope,issue,policy,signal):Promise<IssueLogSetRef>`、`retry(id,signal):Promise<IssueLogSet>`。repository 按 source scope + issueVersion/generation 原子更新状态；解析器消费本地内容对象，返回文件清单。

- [ ] 1. 写失败测试：并发最多 2；同一附件版本跨代码项目只下载一次；附件变更产生新 generation；旧下载完成不能覆盖新状态；中断/磁盘写失败/重启后未完成文件不为 READY；有引用内容可重新读取。
- [ ] 2. 写 ZIP 与文本测试：精确预算边界及超限 1 字节、压缩炸弹、路径穿越、绝对路径、Windows 盘符、链接、重复路径、密码包、截断包、嵌套 3 层/10001 文件均明确处理；未知编码不伪装 UTF-8，原件保留，解析范围可见。
- [ ] 3. 运行 `npm test -- packages/core/src/issues/issue-log-service.test.ts packages/adapters/src/logs packages/storage/src/issue-material-repository.test.ts packages/storage/src/migrations.test.ts`，确认失败；实现 schema v9、备份/回滚和原子流式落盘，取消时清理仅本任务临时文件。旧版本引用不得被删除。
- [ ] 4. 锁定 yauzl 3.4.0，使用 lazyEntries/validateEntrySizes，读取条目时同时累计实际解压字节；类型声明只覆盖实际使用 API。原件保存在内容存储，包内路径只作元数据，不直接拼成本机可执行路径。提供内容引用清单供现有清理接口使用，不新增自动清理任务。
- [ ] 5. 目标测试通过，v8 备份可恢复且旧记录不变；提交本任务。

### Task 3：问题刷新自动准备日志及界面反馈

**Files:** 修改 `packages/core/src/issues/issue-service.ts`、`packages/core/src/issues/issue-monitor.ts`、`apps/desktop/src/service/workbench.ts`、`apps/desktop/src/service/service.ts`、`packages/contracts/src/ipc.ts`、`packages/contracts/src/models.ts`、`packages/contracts/src/issue-monitor.ts`、`apps/desktop/src/preload/preload.ts`、`apps/desktop/src/renderer/pages/BugsPage.tsx`；新增 `apps/desktop/src/renderer/components/IssueLogMaterials.tsx`、`tests/e2e/issue-log-download.spec.ts`。

**Interfaces:** 发布有效问题批次后调用任务 2 的 enqueue，刷新返回问题与材料状态；`getIssueLogState({projectId,issueSnapshotId})`、`retryIssueLogs(...)`、`openIssueMaterial({projectId,logSetId,fileId})`。打开文件由 main 按归属解析内容对象，不接受 renderer 任意磁盘路径。

- [ ] 1. 写失败测试：刷新后立即出现 QUEUED/DOWNLOADING，再到 READY；已确认无日志为 NO_LOGS；下载失败保留问题、明确错误且能重试；账号变化清除不再授权的视图；项目发现搜索不会触发下载或通知。
- [ ] 2. 在旧包运行新桌面用例，确认因缺少材料入口失败。对后台队列写单测，确认日志与问题读取状态互不掩盖，Trinity 多项目只安排一次下载。
- [ ] 3. 接入材料状态、大小、进度、重试及原件打开；刷新只调度下载，不等待全部大文件结束，不调用 AI；轮询/手动刷新共用同一发布入口，不另设第二刷新实现。
- [ ] 4. 运行核心问题测试及新桌面用例，确认网络请求使用原平台连接和直连；失败及权限变更均可见。
- [ ] 5. 提交本任务，形成可独立验收的日志获取子计划。

## 子计划 B：当前工作区不可变快照

### Task 4：捕获当前文件并统一取证读取

**Files:** 新增 `packages/adapters/src/git/worktree-snapshot.ts`、`packages/adapters/src/git/worktree-snapshot.test.ts`；修改 `packages/contracts/src/models.ts`、`packages/contracts/src/analysis.ts`、`packages/core/src/ports.ts`、`packages/core/src/context/context-reader.ts`、`packages/core/src/context/access-policy.ts`、`packages/core/src/analysis/evidence-validator.ts`、`packages/core/src/search/search-service.ts` 及其测试。

**Interfaces:** `captureWorktree(binding,content,signal):Promise<WorktreeRepositorySnapshot>`；`assertWorktreeCurrent(snapshot,signal):Promise<void>`；ContextReader.readCode 继续提供统一入口，Git 快照读 blob，worktree 快照读经过哈希验证的内容对象。新增 worktree-code 证据与统一代码证据判定。

- [ ] 1. 写失败测试：dirty/已暂存/未跟踪文件内容可读，删除不再可读，配置分支与当前分支不同不切换，detached HEAD 记录实际状态；读取快照后即使磁盘改动，快照内容仍不变且完成校验拒绝旧结论。断言 Git 命令未出现 fetch/pull/rebase/checkout/stash。
- [ ] 2. 写竞态/隔离测试：捕获期间修改、删除再创建、目录链接与文件链接、忽略的构建产物及敏感文件均不能越界；大文件/路径上限失败可见；原目录 HEAD、索引和工作树保持不变。
- [ ] 3. 运行 `npm test -- packages/adapters/src/git/worktree-snapshot.test.ts packages/core/src/context/context-reader.test.ts`，确认失败；实现文件捕获和稳定性校验。文件清单由 Git 跟踪列表与非忽略未跟踪列表组成，再经过统一敏感/产物过滤；捕获前后复核清单与内容哈希，不用静默 retry 拼接时点。
- [ ] 4. 同步更新按类型分派的证据验证与索引；旧 Git code/document 证据及报告回归通过。不能把 worktree contentHash 放入旧 blob 字段蒙混通过。
- [ ] 5. 提交本任务；不改变既有 Git 更新行为。

### Task 5：BUG 任务使用日志与当前代码，报告明确材料版本

**Files:** 修改 `packages/core/src/tasks/task-service.ts`、`packages/core/src/analysis/analysis-pipeline.ts`、`packages/core/src/analysis/prompts.ts`、`packages/contracts/src/issues.ts`、`packages/contracts/src/models.ts`、`packages/contracts/src/analysis.ts`、`packages/contracts/src/ipc.ts`、`packages/storage/src/analysis-repository.ts`、`apps/desktop/src/service/workbench.ts`、`apps/desktop/src/service/service.ts`、`apps/desktop/src/preload/preload.ts`、`apps/desktop/src/renderer/pages/BugsPage.tsx`、`apps/desktop/src/renderer/pages/BugReportPage.tsx`、`apps/desktop/src/renderer/pages/ReportPage.tsx`、`apps/desktop/src/renderer/components/TaskDetails.tsx`；新增 `packages/storage/src/bug-current-code-task.test.ts`、`tests/e2e/bug-current-code.spec.ts`。

**Interfaces:** TaskRuntime 增加 `prepareIssueMaterials(task,issueSnapshotId,signal):Promise<IssueLogSetRef>` 与 `captureCurrentCode(binding,signal)`；ContextSnapshot 增加 issueLogs 引用。`ContextReader.searchLogs(query,limit)` 与 `readLog(logSetId,fileId,startLine,endLine)` 返回 log 证据。新增报告 schemaVersion 2，读取继续兼容 v1。

- [ ] 1. 写失败测试：默认 required 在日志失败/不支持时进入 WAITING_INPUT；只有明确 code-only 才允许跳过并写入报告；下载取消不产生成功任务；代码带未提交改动也能进入分析；资料变化使最终保存失败。
- [ ] 2. 写管线测试：模型实际调用 readLog 后才能引用日志片段；伪造、跨 issue/project/context、过期 logSet 及未取得的代码证据被拒绝；新旧 code 类型均满足“必须有代码依据”；日志不足不伪造根因。
- [ ] 3. 实现固定顺序 `ISSUE_REFRESH → ISSUE_LOGS → CODE_SNAPSHOT → INDEXING → ANALYSIS → VALIDATING`，仅 BUG 使用工作区捕获，取消 BUG 的远端分支/dirty 前置 gate；手动更新代码与需求任务保持既有语义。
- [ ] 4. 按新对象参数统一更新 analyzeBug 调用、重试选项和 IPC 验证；按钮改为“基于当前代码预分析”；报告显示实际分支/HEAD、工作区 manifestHash、日志使用范围与明确跳过记录，导出与界面采用同样解释。
- [ ] 5. 运行任务、取证、需求核对原有回归及新桌面用例；通过后提交本任务。

## 子计划 C：AI 服务与代理协议自适应

### Task 6：地址解析与无材料协议探测

**Files:** 新增 `packages/contracts/src/ai-address.ts`、`packages/contracts/src/ai-address.test.ts`、`packages/adapters/src/network/ai-endpoint.ts`、`packages/adapters/src/network/ai-endpoint.test.ts`；修改 `packages/contracts/src/analysis.ts`、`packages/adapters/src/network/policy.ts`、`packages/adapters/src/network/policy.test.ts`。

**Interfaces:** 使用本计划接口约定中的 parseAIAddress/resolveAIEndpoint。解析器不进行网络调用；解析结果保留 API 路径，proxy 不接受业务路径。探测通过注入传输实现，缓存以地址、配置版本和代理为键，不独立保存另一条连接。

- [ ] 1. 写失败测试：`host:8443/v1`、完整 HTTPS/HTTP、IPv6、空白、重复协议、账号密码、查询/片段、代理路径；断言 API 两候选分别为 `https://host:8443/v1` 与 `http://host:8443/v1`，拒绝含凭据输入。
- [ ] 2. 写失败测试：HTTPS 成功不探测 HTTP；TLS 协议不兼容再选 HTTP；两者失败保留两阶段错误；HTTPS 401/403/405/429 仍为协议可达而不降级；探测携带零 Authorization、零代码/日志、零聊天正文。
- [ ] 3. 运行 `npm test -- packages/contracts/src/ai-address.test.ts packages/adapters/src/network/ai-endpoint.test.ts`，确认失败，再实现探测。单候选 5 秒超时、用户取消立即停止；API 使用无凭据 HEAD（405 仍有效），proxy 仅证明协议监听可达，不能把它标成上游模型成功。
- [ ] 4. 代理先选择，API 再经所选代理探测；缓存失效仅影响下一次探测，已发送 POST 后不因网络错误自动重发。测试 POST 计数必须为 1。
- [ ] 5. 测试通过并提交本任务。

### Task 7：API/订阅连接接入统一协议选择与诊断

**Files:** 修改 `packages/adapters/src/ai/chat-completions.ts`、`packages/adapters/src/ai/subscription.ts`、`packages/adapters/src/ai/identity.ts`、`packages/adapters/src/ai/executor.test.ts`、`apps/desktop/src/service/workbench.ts`、`renderer/pages/ConnectionsPage.tsx`、`packages/contracts/src/models.ts`、`packages/contracts/src/ipc.ts`、`apps/desktop/src/preload/preload.ts`、`packages/storage/src/migrations.ts`；新增 `tests/e2e/ai-address-selection.spec.ts`。

**Interfaces:** transport 接收 resolver 与诊断回调，API 只向所选完整 URL 发一次模型 POST；订阅 CLI 仅把所选代理传入现有 aiEnvironment，不修改其账号服务端点。诊断记录所选 API/proxy 协议及简要 HTTPS 失败码。

- [ ] 1. 写失败测试：CLI HTTPS 代理握手失败/HTTP 可达时只启动一次 CLI，其环境为 HTTP 代理；CLI 不继承其他系统代理；API 业务错误不换协议；敏感错误正文不外泄。
- [ ] 2. 写存储兼容与桌面测试：旧完整 URL 自动规范，连接 ID、密钥引用、默认关系和项目覆盖保持；编辑同一连接可更新地址而不创建重复连接；API/代理均显示两个候选和最后选中协议，HTTP 标为未加密。
- [ ] 3. 扩展现有保存 AI 连接入口接受可选 id，编辑时保留未重新输入的密钥；新增编辑按钮。复用同一 schema 校验和保存逻辑，不直接改数据库绕过入口。编辑后令关联诊断缓存失效并触发执行配置 hash 变化校验。
- [ ] 4. 接入探测与运行诊断；“协议探测通过”不得写成模型已调用成功，模型/额度等失败仍分开报告。CLI 不支持的选项或模型名错误原样作为可定位错误，不自动换模型。
- [ ] 5. 运行 AI 适配器、网络策略、旧配置和新桌面回归，通过后提交本任务。

## 总集成与交付

### Task 8：真实联调、整体验证与 0.8.0 打包

**Files:** 修改 README.md、package.json/lock；新增 `docs/BUG日志与当前代码预分析及AI协议自适应验收.md`；更新受影响的现有 e2e 文案与接口调用。三个子计划未全部达标时不标为最终交付。

- [ ] 1. 本地隔离测试串联刷新/下载/解包/日志取证/dirty 快照/协议选择/报告保存，模型模拟必须读取日志与修改后的代码才能返回可验证结论。回归 Trinity 多对多映射、Jira 刷新、飞书固定接收人、文档与默认 AI 继承。
- [ ] 2. 在本地 Node 运行：`npm test`、`npm run typecheck`、`npm run lint`；全部未跳过测试通过，既有可选 Jira CLI 验证缺配置时如实列出跳过项，不掩盖失败。
- [ ] 3. 通过 Forge `PLATFORM_BUILD_DIR=out/releases/0.8.0` 执行 `npm run make`，设置现有 Node/npm 与 Electron 离线缓存路径；发行时备份/迁移真实数据库，先退出同数据目录旧应用。保留当前工作目录与用户文件，不删除旧发行包。
- [ ] 4. 对新便携程序设置 PLATFORM_EXECUTABLE，运行 `npm run test:e2e -- tests/e2e/issue-log-download.spec.ts tests/e2e/bug-current-code.spec.ts tests/e2e/ai-address-selection.spec.ts tests/e2e/account-bug-links.spec.ts tests/e2e/resource-associations.spec.ts tests/e2e/notification-recipient.spec.ts`。检查关键截图及实际报告。
- [ ] 5. 使用当前 Trinity 账号及 `APP2026012615095269453` / `BUG20261020_14151` 验证真实问题日志；无日志或失效时如实记录，并选有附件且在同账号权限内的问题验证下载。会话失效由用户自行登录，不输出 token。AI 通过现有连接编辑入口归一化代理，核对实际模型响应；不发测试消息或更改 BUG。
- [ ] 6. BUG 工作区验证使用隔离的临时 Git 夹具添加未提交修改；真实业务分析仍用 `D:/development/AnalysisProjects/E0V空调/SVHvacApp`，不人为修改业务代码或切回原目录。
- [ ] 7. 校验 ZIP 与便携文件清单和 SHA-256 一致，检查最终 diff 的重复逻辑、吞错、旧 gate、旧调用与凭据泄漏；保存模拟/真实验证的各自边界，提交验收记录并提供启动文件与安装包。

## 依赖、交付边界与自审

顺序：Task 1 → 2 → 3；Task 4；Task 6 → 7；Task 5 依赖 2、4；Task 8 依赖 3、5、7。任务 1 若遇真实接口阻断，先推进 4、6、7，不用伪造端点推进 2 的真实适配。每个子计划完成后可独立验收，最终统一打包。

计划已对照设计自审：日志发现/下载/解析/UI/取证由 1–3、5 覆盖；dirty 快照及旧报告兼容由 4、5 覆盖；两个 AI 地址及旧配置由 6、7 覆盖；真实联调与打包由 8 覆盖。五项 Review Focus 均已指定失败测试，预算、方法名和材料引用名保持一致。

ZIP 选择依据：[yauzl 官方文档](https://github.com/thejoshwolfe/yauzl)说明按中央目录读取、lazyEntries、validateEntrySizes；[官方 package.json](https://github.com/thejoshwolfe/yauzl/blob/master/package.json)标注 3.4.0。实施时安装精确版本并锁入生产依赖，任何安装或兼容失败须明确处理，不改成自写解压器。

## 评审与执行

用户已认可本计划，沿用当前会话直接实施。任务 1—7 已完成；任务 8 已完成自动验证与打包，真实模型已调用，完整报告仍待修正用户配置的模型 ID 后重试。具体证据、实施裁定和限制见 [0.8.0 验收记录](BUG日志与当前代码预分析及AI协议自适应验收.md)。
