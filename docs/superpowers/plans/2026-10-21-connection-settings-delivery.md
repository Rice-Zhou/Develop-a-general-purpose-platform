# 连接设置收拢与本地交付 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Jira、Trinity、AI 连接默认显示保存列表，按需编辑并交付可启动新版本。

**Architecture:** 保留已有登录、模型发现与删除服务，列表容器仅控制编辑器生命周期。新增/编辑共用现有表单能力，取消卸载并清除未保存秘密，最后统一回归和发行。

**Tech Stack:** Electron 44.9.0、React 19.3.1、TypeScript 5.9.3、Zod、better-sqlite3、Vitest、Playwright、Electron Forge/Squirrel。

**Spec:** [已批准设计](../specs/2026-10-21-requirement-review-library-settings-design.md)。

## Global Constraints

- 固定开发目录 `D:/development/Develop-a-general-purpose-platform`，沿用当前会话直接实施。
- 当前工作区包括未提交修改；所有需求上下文、提取、核对均禁止 fetch/pull/rebase/synchronize，保留项目管理手动更新代码。
- 资料、关联、报告、执行队列各只有一个规范来源；错误可见，不静默回退或模拟成功。
- 人工分类初始无预选；误报保存即隐藏；未完成须勾选确认后才出现完成选项。
- 后端测试默认 60000ms；隔离测试数据，不修改真实连接凭据，不自动发送通知。
- 本次本地交付目标按已发布 1.0.1 的下一补丁版设为 1.0.2；不覆盖 1.0.1、不上传或发布新 Release；网络策略与更新下载优化不在本次范围。

## Review Focus

1. 打开设置不探测 Codex 模型、不报未登录错误（C1/C2）。
2. 编辑后 ID/项目关联不变，取消/重开无残留密码（C1/C2）。
3. Jira 多连接、Trinity 单账号及全项目默认关联不退化（C1）。
4. 删除有引用的 AI 仍需要明确替换/解除关联，不隐式切换（C2）。
5. 原生 SQLite ABI、旧库升级与旧客户端拒绝新库均在隔离环境验证（C3）。

## 文件与边界

- 修改 `apps/desktop/src/renderer/pages/IssueConnectionsPage.tsx`、`ConnectionsPage.tsx`。
- 在有必要抽离时新建 `apps/desktop/src/renderer/components/IssueConnectionEditor.tsx`、`AIConnectionEditor.tsx`：唯一表单实现，页面/项目嵌入均复用。
- 修改 `tests/e2e/account-bug-links.spec.ts`、`platform-login.spec.ts`、`codex-discovery.spec.ts`、`ai-delete.spec.ts`、`trinity-auto-login.spec.ts` 的显式新增/编辑导航，不弱化原业务断言。
- 发行仅修改 `package.json/package-lock.json`、`README.md` 与新验收记录；生成文件进入 `out/releases/1.0.2`。

### C1：BUG 连接列表与按需编辑

**Interfaces:** 共用编辑器接收 `{connectionId?:string,onSaved:()=>void,onCancel:()=>void,embedded?:boolean}`；无 connectionId 为新增，存在则载入同一保存连接。列表页使用 `editing:null|{kind:'jira'|'trinity',id?:string}`；无第二套保存/登录实现。

- [x] **RED 测试：** 新建 `tests/e2e/connection-panels.spec.ts` 的 BUG 场景。断言初始仅保存列表、Jira/Trinity 分组；新增/编辑才见字段；取消/保存收起，取消后重开密码为空；不提交不登录。编辑保留 ID/关联；删除已关联 Jira 的原行为保留；Trinity 唯一账户与后续创建项目默认关联保留。
- [x] **运行失败测试：** `& $node node_modules/@playwright/test/cli.js test tests/e2e/connection-panels.spec.ts tests/e2e/account-bug-links.spec.ts tests/e2e/platform-login.spec.ts tests/e2e/trinity-auto-login.spec.ts`，预期初始表单仍可见。
- [x] **实现：** IssueConnectionsPage 显示最小已保存摘要与新增/删除入口；详情默认折叠，编辑显式挂载共用表单。CLI 读取与登录探测仅在激活对应编辑器时进行；取消卸载编辑器，保存成功关闭。保留 Trinity 密码保存/自动登录选择及通知文案，不删除已保存密钥来代替清理输入框。
- [x] **GREEN：** 同命令 PASS；项目内嵌新增/编辑同样回归通过。
- [x] **提交：** `refactor: show bug connection editors only on explicit actions`。

### C2：AI 连接列表与表单生命周期

**Consumes:** 现有 discoverCodex、模型选择、probe、save/delete AI 与默认连接 API。
**Produces:** AIConnectionEditor 与 C1 同样的 onSaved/onCancel 生命周期；已保存列表可独立操作默认、检查和删除。

- [x] **RED 测试：** 扩展 connection-panels.spec.ts 的 AI 场景。断言初始无模型表单且 discover/probe 调用零；新增 Codex 才发现最新 CLI/真实模型；保存/取消关闭；编辑保持 ID。已关联 AI 删除仍展示影响项目与替代/解除选择，取消删除不变；无替代时不偷偷使用其他连接。
- [x] **运行失败测试：** `& $node node_modules/@playwright/test/cli.js test tests/e2e/connection-panels.spec.ts tests/e2e/codex-discovery.spec.ts tests/e2e/ai-delete.spec.ts`，预期初始 form/自动探测断言失败。
- [x] **实现：** ConnectionsPage 默认保存列表与默认标记，显式新增/编辑才挂载表单。将表单专属 effects 移入编辑器，保留 API/代理协议选择和 CLI 最新版本规则；保存失败留在表单并报错。飞书 CLI 区保持现有能力，不纳入本次改写。
- [x] **GREEN：** 同命令 PASS；`& $node node_modules/typescript/bin/tsc --noEmit` 与 `& $node node_modules/eslint/bin/eslint.js .` PASS。
- [x] **提交：** `refactor: minimize saved AI connections and scope editor effects`。

### C3：整体验收、迁移安装与 1.0.2 打包

**Consumes:** A1—C2 已通过的行为；现有 Forge/Squirrel 与 scripts/generate-update-manifest.ts。
**Produces:** `out/releases/1.0.2` 的启动程序、安装包、ZIP、更新清单及 `docs/验收/1.0.2-需求审核资料库与连接设置验收.md`；无需发布 GitHub。

- [x] **先验收：** 单元全量 `& $node node_modules/vitest/vitest.mjs run`；类型/lint 同 C2；桌面运行 A2/B4/C1/C2 场景并回归 task-navigation、bug-task-queue、bug-report-reading、code-update、client-update。桌面测试前统一重建 Electron SQLite，禁止与 Node 单测/打包同时重建原生依赖。任何失败需明确定位，不能以跳过掩盖。
- [x] **升级测试：** 使用脱敏 schema10 测试库进行“旧版数据→新版启动→资料/关联/报告读取→人工状态保存→重启”；另在隔离副本由旧客户端打开最终 schema12，明确 DATABASE_NEWER。真实库不用于自动化破坏性测试。迁移备份包含唯一旧资源/关联来源，新库重启无重复。
- [x] **修改发行信息：** package/package-lock 同步 1.0.2，README 准确说明人工分类、当前代码审核、独立资料库和按需连接表单；不宣称引用资料均可解析，不宣称更新网络问题已解决。
- [x] **打包：** `& $node node_modules/@electron-forge/cli/dist/electron-forge.js make`；由现有 forge.config.ts 的 postMake 自动调用 generateUpdateManifest({version,installerPath,outputPath}) 生成清单（脚本没有独立 CLI，不另造调用方式），核对 manifest.version=1.0.2、安装包 SHA256 和大小。启动包和安装器必须与同一提交/版本对应；保留已发布 1.0.1 文件原样。
- [x] **最小 smoke：** 在隔离用户数据目录启动产物，完成零项目保存资料、项目关联、AI mock 有效审核与人工处理/重启、设置新增取消。检查实际窗口版本1.0.2。安装器如需真实安装当前用户环境，先完成可审阅产物及校验，再沿用明确授权或请求必要安装许可；不假称已实际安装。
- [x] **提交与交付：** 检查 diff 中无重复资源存储/第二关联/吞错/意外代码更新、密钥或生成日志；提交 `release: prepare 1.0.2 requirement review and resource library`。验收记录列命令、结果、产物哈希及真实外部 AI/飞书未验证边界。最终给绝对路径启动文件、安装包与验收文档，不上传 Release。

## 执行结果（2026-10-21）

已按计划完成并本地打包 1.0.2。独立审查追加 schema13 以固定人工决定的报告依据；当前代码策略、队列与资源规范来源不变。最终单测 340 通过、5 环境条件跳过；打包程序桌面回归 17/17、类型、lint 和发行清单校验通过。详见 [验收记录](../../验收/1.0.2-需求审核资料库与连接设置验收.md)。
