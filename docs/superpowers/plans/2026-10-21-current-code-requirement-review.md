# 当前代码需求审核与人工待办 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 使用有效 AI 审核当前代码，可靠保存误报、未完成及完成决定。

**Architecture:** 新增审核决定存储引用不可变报告；语义指纹独立于提取 UUID。新增 AUDIT_REQUIREMENTS 任务串行捕获、提取和核对，沿用既有队列与证据验证，报告及决定归并同事务。

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

1. 相同语义的新提取 UUID 不重复开单，实质内容变化不继承旧误报（B1）。
2. 晚返回报告、乐观并发冲突和重复保存不覆盖人工决定（B1/B3）。
3. 未提交修改可分析，所有需求任务零网络 Git 更新（B2）。
4. AI/资料失败及审核期间变更不会保存成功报告或错误重开待办（B3）。
5. 单选/两级确认、单项保存失败及切换项目晚返回（B4）。

## 文件与边界

- 新建 `packages/contracts/src/requirement-review.ts`、`packages/core/src/requirements/review-service.ts`、`packages/storage/src/requirement-review-store.ts`：人工状态、语义身份与事务归并。
- 修改 `packages/storage/src/migrations.ts`、`database.ts`、`packages/core/src/ports.ts`：在 A1 的 schema11 基础上迁移至 schema12，加入审核条目/事件表和完成事务。
- 修改 `packages/core/src/tasks/task-service.ts`、`apps/desktop/src/service/workbench.ts`、`packages/core/src/analysis/analysis-pipeline.ts`：复用当前工作区快照、AI 提取核对。
- 修改 contracts `models.ts/ipc.ts`、desktop `preload/preload.ts`：类型化 API 与任务类型。
- 修改 `renderer/pages/RequirementsPage.tsx`、`DocumentsPage.tsx`；新建 `renderer/components/RequirementReviewList.tsx`：人工待办和按操作归属错误。

### B1：稳定身份、人工决定与归并规则

**Interfaces:** `RequirementReviewItem={id,projectId,fingerprint,state,revision,reportId,requirementSetId,requirementId,historicalSource,updatedAt}`；state=`PENDING|CONFIRMED_MISSING|FALSE_POSITIVE|DONE`。列表内容从所引报告/需求版本投影，不复制报告结论。事件追加保存 actor/action/时间及引用。
`reviewFingerprint(projectId:string,item:RequirementItem,sources:ReviewSource[]):string`，`ReviewSource={resourceId,quoteHash}`，由合法 sourceRefs 解析；规范化文本采用 Unicode NFC、trim 和连续空白归一；来源及验收条件排序，剔除重复，使用带版本号的规范 JSON SHA256，不包含 AI explanation/任何临时 UUID。
`getRequirementReviews(projectId:string):RequirementReviewItem[]`；`setRequirementReviewDecision(id:string,action:'false-positive'|'confirm-missing'|'complete'|'restore',expectedRevision:number):RequirementReviewItem`，按上述状态机验证，不允许 PENDING 直接 complete。
`ReviewRunToken={decisionSequence:number}` 为审核开始前该项目人工事件序号水位；Task 可选保存 `reviewRunToken`。`reconcileRequirementReviews(report:AnalysisReport,set:RequirementSet,sources:ReviewSourceIndex,runToken:ReviewRunToken):void` 在调用方事务内执行；ReviewSourceIndex 按合法 documentSnapshotId/blockId 解析资源 ID 和 quoteHash。

- [x] **RED 测试：** 新建 `packages/core/src/requirements/review-service.test.ts` 和 `packages/storage/src/requirement-review-store.test.ts`。断言新提取 ID/来源快照 ID/AI 措辞变化指纹不变；文本/引用/验收变化不同；项目隔离。MISSING/PARTIAL 新建 PENDING；误报同指纹不重开；DONE 再缺失重开 PENDING；UNKNOWN 不重开；IMPLEMENTED 不替用户完成；旧源待办保留且标 historicalSource。重复 report 幂等，过期 revision 拒绝；保存失败不修改状态/事件；人工刚完成后本轮晚报告不重开，后续新一轮缺失才重开。schema10/11 均升级12并备份，重复打开不重复建表。
- [x] **运行失败测试：** `& $node node_modules/vitest/vitest.mjs run packages/core/src/requirements/review-service.test.ts packages/storage/src/requirement-review-store.test.ts`，预期缺少新服务。
- [x] **实现：** 定义契约、纯指纹/状态规则和 DB 存储，通过 schema11→12 的独立原子迁移创建审核表与事件表（新库也顺序完成 11、12；不修改已执行的 11 迁移）。指纹(projectId,fingerprint) 唯一；报告归并时读取当前人工状态，事件和状态同事务；不会因最新提取漏项就自动处理旧项。同一报告重复归并不重开刚处理的状态。事件使用单调递增 sequence；最新人工决定 sequence 大于 runToken.decisionSequence 时，仅更新最新报告引用，不改变人工状态，防止本轮模型覆盖刚完成或恢复的操作。之后新一轮审核才允许根据缺失结论重开 DONE。读取结果包含旧来源和最新结论提示所需的投影，不设第二报告来源。
- [x] **GREEN：** 重跑两文件并回归 migrations.test.ts，PASS。
- [x] **提交：** `feat: persist requirement review decisions with semantic identities`。

### B2：所有需求任务捕获当前代码

**Consumes:** 既有 `captureCurrentCode(binding,signal)` 运行时能力及 captureWorktree；保留手动更新命令。
**Produces:** PREPARE_CONTEXT/EXTRACT_REQUIREMENTS/CHECK_REQUIREMENTS 与后续 AUDIT_REQUIREMENTS 使用同一当前代码上下文分支；统一配置哈希和新鲜度校验。

- [x] **RED 测试：** 扩展 `packages/core/src/tasks/task-service.test.ts`、`apps/desktop/src/service/workbench-freshness.test.ts`。对三种现有需求任务逐一断言脏文件/未跟踪文件进入快照，git.synchronize/update/continueUpdate 调用零；HEAD、分支、工作区内容前后一致。执行显式 UPDATE_CODE 仍调用原更新流程；快照中途修改检测失败。
- [x] **运行失败测试：** `& $node node_modules/vitest/vitest.mjs run packages/core/src/tasks/task-service.test.ts apps/desktop/src/service/workbench-freshness.test.ts`，预期需求任务仍同步或拒绝 dirty。
- [x] **实现：** 删除需求路径的 git.assertReady/synchronize 门槛，复用 BUG 的当前代码捕获和工作区输入哈希逻辑，收敛为共同策略函数；运行时缺失能力显式失败，不回退到同步代码。只对显式更新任务使用更新逻辑。文档关联/内容修订和工作区变更纳入当前需求任务新鲜度；分类元数据不参与。
- [x] **GREEN：** 同命令 PASS，并检查上述任务代码无残余同步分支。
- [x] **提交：** `fix: audit requirements against current worktree without code updates`。

### B3：一键审核、证据校验与原子保存

**Interfaces:** `auditRequirements(projectId:string):Promise<Result<Task>>`（DesktopAPI；服务内部返回 Task） → 队列新增 `AUDIT_REQUIREMENTS`，沿用取消/重试/项目串行。运行时新增结果分支 `{kind:'requirement-audit',set:RequirementSet,report:AnalysisReport}`；TaskRepository 新增 `completeRequirementAudit(task:Task,context:ContextSnapshot,set:RequirementSet,report:AnalysisReport):void`。A1/B1 的资源引用及审核规则在该事务内调用。

- [x] **RED 测试：** 新建 `packages/core/src/requirements/audit-flow.test.ts`；扩展 `packages/core/src/analysis/pipeline.test.ts`。断言无有效 AI 入队前失败；一次任务完成捕获→读取→提取/核对；有效人工修订仅在来源与内容新鲜时复用。非法来源/缺失代码证据、模型失败、取消和文件中途变化不产生成功报告/决定；UNKNOWN/CONFLICT 不建缺失待办。模拟模型等待期间用户保存误报或完成，晚报告仍保留；在报告保存后注入归并失败，set/report/task/决定事务全部回滚。
- [x] **运行失败测试：** `& $node node_modules/vitest/vitest.mjs run packages/core/src/requirements/audit-flow.test.ts packages/core/src/analysis/pipeline.test.ts`，预期缺少一键审核及事务路径。
- [x] **实现：** Workbench 获取项目实际生效 AI，复用现有提取和核对 prompt/证据验证；来源无变化时复用已有有效 RequirementSet，变化则提取新版本。审核开始前持久化 Task.reviewRunToken，完成事务向 B1 归并传入该 token；重试获取新 token。捕获上下文后不得换用旧上下文；提交前再校验输入/配置新鲜度。完成事务保存本次上下文/需求版本/报告/任务终态并归并人工条目。旧 checkRequirements 也调用同一归并入口，避免两个入口行为不同；不为准备上下文/单独提取生成虚假审核待办。
- [x] **GREEN：** 同命令及 B1/B2 目标测试 PASS；取消与失败在任务历史可见。
- [x] **提交：** `feat: run atomic current-code requirement audits in the task queue`。

### B4：需求页面人工处理与准确错误提示

**Consumes:** `auditRequirements/getRequirementReviews/setRequirementReviewDecision`，继续使用原文读取和人工修订 API。
**Produces:** RequirementReviewList 的纯界面状态只保存尚未确认的单选；已保存状态从后端读取。当前任务/当前操作错误与每项写入错误分开。

- [x] **RED 测试：** 新建 `tests/e2e/requirement-review.spec.ts`，更新 `requirements.spec.ts`。断言无预选；误报成功即隐藏且刷新仍隐藏；未完成单选只展开确认，勾选确认成功才出现完成控件，完成后隐藏；失败保留 item/选择并显示错误。已处理可展开/恢复；同版误报不重现、完成重检缺失重开；信息不足单列。注入 BUG/日志失败不得出现在需求原文，真实解析错误可见；切换项目后旧请求不覆盖新页。
- [x] **运行失败测试：** `& $node node_modules/@playwright/test/cli.js test tests/e2e/requirement-review.spec.ts tests/e2e/requirements.spec.ts`，预期缺少人工处理控件。
- [x] **实现：** 主按钮“AI 审核当前代码”，显示有效 AI/不可用原因与设置入口；执行状态链接统一任务列表。待办显示原文、验收、AI 说明、范围与依据；已处理/人工修订/历史报告为二级折叠入口。删除 latestTask?.error 的跨任务展示和隐含更新提示；按本次需求任务 ID 关联真实执行失败。每项请求期间防重复点击，保存成功再移除；revision 冲突提示重新加载，不假成功。项目切换/卸载使用请求代际保护。
- [x] **GREEN：** 两桌面文件 PASS，覆盖初始无资料/无报告时为普通引导；类型检查 PASS。
- [x] **提交：** `feat: add human-reviewed requirement tasks and scoped operation errors`。

## 执行结果（2026-10-21）

已按计划完成并本地打包 1.0.2。独立审查追加 schema13 以固定人工决定的报告依据；当前代码策略、队列与资源规范来源不变。最终单测 340 通过、5 环境条件跳过；打包程序桌面回归 17/17、类型、lint 和发行清单校验通过。详见 [验收记录](../../验收/1.0.2-需求审核资料库与连接设置验收.md)。
