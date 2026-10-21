# 独立资料库与数据迁移 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 无代码项目时也能管理多级分类与资料，并按需关联为审核需求或参考资料。

**Architecture:** 扩展现有文档为 LibraryResource 联合类型，SQLite 表成为唯一资源及项目关联来源。旧文档接口仅返回可解析投影，不保留第二份资料或关联。

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

1. schema 10 的共享资料 ID、required、关联和已有报告必须原样保留（A1）。
2. 迁移失败后重启不得留下半张新表或丢掉旧设置（A1）。
3. 分类自循环、后代循环、孤儿分类及非空删除均拒绝（A1）。
4. 分类移动和改名不修改内容版本或项目关联（A1）。
5. 零项目、离线路径、无法解析的 UI/UE 链接仍可保存（A2）。

## 文件与边界

- 新建 `packages/contracts/src/library.ts`：资源/分类/关联类型与边界校验。
- 新建 `packages/storage/src/library-store.ts`：在现有 DB 连接内管理分类、资料、关联，支持调用方事务。
- 修改 `packages/storage/src/migrations.ts`、`database.ts`：schema 11 与兼容文档投影；不复制历史内容文件。
- 修改 `packages/contracts/src/models.ts`、`ipc.ts`、`apps/desktop/src/preload/preload.ts`、`apps/desktop/src/service/workbench.ts`：统一类型与 IPC。
- 修改 `apps/desktop/src/renderer/pages/DocumentLibraryPage.tsx`、`components/DocumentResourceEditor.tsx`、`components/ProjectDocumentsDialog.tsx`、`components/ProjectEditor.tsx`、`renderer/App.tsx`：分类、可选关联及现有入口接入。

### A1：规范资源、关联与原子迁移

**Interfaces:** 新增 `LibraryResource`：`id/name/categoryId/purpose/notes/revision/contentRevision`，`purpose` 为 `requirement|ui|ue|general`，`categoryId` 可空；按 `kind` 区分 `docx|pdf|feishu|url|path` 的 `locator` 与 `note` 的 `text`。`LibraryCategory={id,name,parentId,revision}`；`ProjectResourceLink={resourceId,role:'requirement'|'reference',required:boolean}`。通用参考资源只能关联 reference。

规范 API（以下为业务返回值；Workbench/IPC/DesktopAPI 同名，前端统一 Promise<Result<T>>，沿用现有 Result 错误契约）：
`getLibrary(): {resources:LibraryResource[],categories:LibraryCategory[]}`；
`saveLibraryResource(draft:LibraryResourceDraft,expectedRevision?:number):LibraryResource`；
`deleteLibraryResource(id:string,expectedRevision:number):void`；
`saveLibraryCategory(draft:LibraryCategoryDraft,expectedRevision?:number):LibraryCategory`；
`deleteLibraryCategory(id:string,expectedRevision:number):void`；
`saveProjectResources(projectId:string,links:ProjectResourceLink[],expectedRevision:number):Project`。
`Project.resourceLinks` 为查询投影。旧 `getDocumentResources/saveDocumentResource/deleteDocumentResource/saveProjectDocuments` 委托同一存储；旧项目表单改用规范关联，不让旧文档数组覆盖 reference 关联。

- [x] **RED 测试：** 新建 `packages/storage/src/library-store.test.ts`；扩展 `migrations.test.ts`、`project-documents.test.ts`。断言 schema10→11 前有备份且资源 ID、关联 required、报告/连接数量不变；再次打开无重复。注入迁移中断后旧结构完整；v12 报 DATABASE_NEWER。分类循环/非空删除失败；删除被关联资料失败；解除一项目关联不删资料或另一项目关联；移动分类保持 contentRevision。
- [x] **运行失败测试：** `& $node node_modules/vitest/vitest.mjs run packages/storage/src/library-store.test.ts packages/storage/src/migrations.test.ts packages/storage/src/project-documents.test.ts`，预期新 API/迁移断言失败。
- [x] **实现：** 新建 `library_categories/library_resources/project_resource_links`，主键与唯一关联约束、参数化 SQL。迁移先备份，旧升级分支统一完成到 10 后同事务迁至 11；将 document-resources 和项目 documentRefs 转入规范表、移除旧持久化来源。项目 JSON 的 documents 只保留空占位，读取时派生可解析 requirement 文档。revision 控制任何修改；contentRevision 仅在 kind/locator/text 内容改变时增加，分类/备注/名称改变不使审核失效。关联角色/required 改变须使对应项目输入失效。分类名称及 URL/文本长度在 Zod 边界校验，不执行普通路径或网址。
- [x] **GREEN：** 重跑上述三文件，全部 PASS；追加 IPC 非法分类/角色/过期 revision 测试，类型检查通过。
- [x] **提交：** `feat: migrate shared resources to an independent categorized library`，仅暂存本任务文件。

### A2：分类导航、资料编辑与项目可选关联

**Consumes:** A1 的 `getLibrary/saveLibraryResource/saveLibraryCategory/saveProjectResources` 和投影。
**Produces:** 同一资料编辑器支持六类资料；分类树和项目关联编辑器，业务数据只由 A1 API 提供。

- [x] **RED 测试：** 新建 `tests/e2e/resource-library.spec.ts`；扩展 `resource-associations.spec.ts`、`project-documents.spec.ts`。断言无代码项目时创建根/子分类、飞书 UI 链接、URL、离线路径、note 均可保存；全部/未分类和名称/地址搜索有效；普通目录不会调用 PDF/Word 解析。随后创建项目可关联同一资源，reference 不进入必读清单，旧 DOCX 需求关联仍可读。
- [x] **运行失败测试：** `& $node node_modules/@playwright/test/cli.js test tests/e2e/resource-library.spec.ts tests/e2e/resource-associations.spec.ts tests/e2e/project-documents.spec.ts`，预期缺少分类与新资源控件。
- [x] **实现：** DocumentLibraryPage 使用分类树+内容区，新增/重命名/移动/删除空分类，显示后端具体错误。DocumentResourceEditor 按 kind 显示 locator/text；用途与关联角色独立，通用引用明确标为参考。ProjectDocumentsDialog 和项目创建/编辑共用资源选择及 role/required 编辑；保存/解除关联不删除资料。未关联项目时仍完整可用；保留原文阅读入口。
- [x] **GREEN：** 重跑上述三桌面文件，确认资料刷新/重启后保持；`& $node node_modules/typescript/bin/tsc --noEmit` PASS。
- [x] **提交：** `feat: add hierarchical standalone resources and optional project links`。

## 执行结果（2026-10-21）

已按计划完成并本地打包 1.0.2。独立审查追加 schema13 以固定人工决定的报告依据；当前代码策略、队列与资源规范来源不变。最终单测 340 通过、5 环境条件跳过；打包程序桌面回归 17/17、类型、lint 和发行清单校验通过。详见 [验收记录](../../验收/1.0.2-需求审核资料库与连接设置验收.md)。
