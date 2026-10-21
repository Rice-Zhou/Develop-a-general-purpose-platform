# 任务导航与 BUG 报告阅读 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一任务入口、按具体 BUG 打开报告、原因优先并在每条证据原位展开内容。

**Architecture:** 复用 tasks、bug_reports、issue_snapshots 和 readEvidence。后端从报告实际使用的问题快照批量计算报告身份，前端以页面状态控制一级任务/二级历史及二级报告阅读；不复制历史、不新增队列或报告表。

**Tech Stack:** React、TypeScript、Zod、SQLite、Vitest、Playwright。

**Spec:** [设计第 2—5 节与验收标准](../specs/2026-10-21-task-bug-reading-release-update-design.md)。

## Global Constraints

- 执行根目录、运行时、超时和交付规则见总计划。
- 报告身份为“分析代码项目 ID + 来源连接 ID + 远端问题 ID”；不可用标题、单号或新快照 UUID 代替。
- 沿用 ACTIVE_TASK_STATUSES；WAITING_INPUT 进入当前任务，其余非活动状态进入历史。
- 删除任务记录不删除报告；没有 AI 连接不阻止阅读已保存报告。

## Review Focus

- 实际报告快照与原任务输入快照不同，刷新后仍能找到原成功报告（A1）。
- 同一 Trinity BUG 在两个代码项目分析，不串报告；连接或映射移除后仅通过允许的历史入口阅读（A1/A3）。
- 任务结束后转入未展开历史，不在 BUG 页面保留第二套任务列表（A2）。
- 无报告、排队、有旧报告但新任务进行中，按钮反馈不同（A3）。
- 证据慢响应、空内容和局部失败只影响该报告该条目（A4）。

### A1：报告身份与批量摘要查询

**Files:** Modify `packages/contracts/src/issues.ts`、`issue-monitor.ts`、`models.ts`、`ipc.ts`，`packages/storage/src/issue-repository.ts`，`apps/desktop/src/service/workbench.ts`、`preload/preload.ts`。Create `packages/storage/src/issue-report-binding.test.ts`；扩展 `packages/contracts/src/ipc.test.ts`。

**Interfaces:** 在 issues.ts 定义 `IssueReportIdentity = {analysisProjectId:string; connectionId:string; remoteId:string}`；`BugReportSummary = IssueReportIdentity & {reportId:string; taskId:string; createdAt:string}`；`BugReportView = {report:BugReport; issue:IssueSnapshot; context:ContextSnapshot}`。仓储新增 `reportSummariesForIssues(identities:IssueReportIdentity[]):BugReportSummary[]`、`reportForTask(projectId:string,taskId:string):BugReport`。在 issue-monitor.ts 定义 `BugWorkspaceIssue = IssueListItem & {reportSummaries:BugReportSummary[]}`，仅桌面工作台 issues 使用该类型；原监控内部 IssueListItem 保持不变。getBugWorkspace 的每条 issue 必须由 Workbench 显式附加数组，空结果也返回 []，不让前端把缺字段默认为“没分析”。DesktopAPI 新增 `getBugReportForTask(projectId,taskId):Promise<Result<BugReportView>>`，复用既有 getBugReport 读取与授权。

- [ ] 写失败测试 `refreshing_snapshot_preserves_report_identity`、`uses_report_snapshot_not_original_task_input`、`same_remote_issue_isolated_by_project_and_connection`、`removed_task_keeps_issue_report_readable`；构造原始输入、新刷新快照和报告使用快照三个不同 UUID，断言只按稳定身份正确命中。
- [ ] 运行 `node node_modules/vitest/vitest.mjs run packages/storage/src/issue-report-binding.test.ts packages/contracts/src/ipc.test.ts`，确认新查询/IPC 缺失导致失败。
- [ ] 实现批量参数化查询：bug_reports JOIN 其实际 issue_snapshots；用参数化 json_each 输入身份集合，避免每 BUG 查询。Workbench 只给当前来源及允许的分析目标查询摘要；getBugReportForTask 同时限制项目与任务，复用报告详情组装。
- [ ] 新增越权项目、同单号不同来源、无报告、已关闭问题从任务历史阅读、失效 AI 仍可读旧报告测试；运行目标测试与 `tsc --noEmit`，均通过。保持现有报告读取接口兼容，暂不删除旧响应字段，更新涉及新返回类型的测试夹具。
- [ ] 检查 diff 后提交 `feat: bind saved bug reports to stable issue identities`。

### A2：统一任务导航与可选二级历史

**Files:** Modify `apps/desktop/src/renderer/App.tsx`、`pages/BugsPage.tsx`、`apps/desktop/src/renderer/styles.css`；Delete `components/BugTaskQueue.tsx`（移除最后引用后）。Create `tests/e2e/task-navigation.spec.ts`；更新 `tests/e2e/bug-task-queue.spec.ts` 中任务历史入口。

**Interfaces:** App 的任务路由区分 `tasks` 和 `task-history`；新增 `TaskFilter = {projectId?:string; issueIdentity?:string}`，BUG 页面通过 `onViewTasks(filter:TaskFilter):void` 导航。过滤使用已有 Task.issueIdentity，不另存任务状态。当前列表=ACTIVE_TASK_STATUSES+WAITING_INPUT，历史列表=SUCCEEDED/FAILED/CANCELLED/INTERRUPTED，二者不交集。

- [ ] 写桌面失败测试：初始无二级历史按钮和历史记录；展开一级任务菜单才出现子菜单，选中才渲染记录；收起后回当前列表；总览不展示结束任务，BUG 工作台不再有完整 BUG 任务列表。
- [ ] 在已打包基线运行新测试，确认因旧菜单/旧重复列表失败；不修改旧包文件。
- [ ] 在 App 现有表格上调整导航、状态分区与项目/问题过滤；保留取消、重试、删除、详情及冲突处理操作，失败计数仅提供进入历史入口。BUG 页面保留每问题任务状态和查看任务导航；移除废弃组件及引用，不抽离无关页面。
- [ ] 更新受影响 E2E 的真实导航步骤，不放宽取消/历史删除断言；验证分析入队不自动离开 BUG 页，其他问题仍可提交。运行任务导航和队列 E2E，类型检查和 lint。
- [ ] 提交 `feat: unify active tasks with collapsible task history navigation`。

### A3：每 BUG 的报告入口和二级报告页

**Files:** Modify `pages/BugsPage.tsx`、`pages/BugReportPage.tsx`、`App.tsx`、`packages/contracts/src/models.ts`、`apps/desktop/src/service/workbench.ts`；Create `tests/e2e/bug-report-binding.spec.ts`；更新旧 BUG E2E 的报告入口。

**Interfaces:** 消费 A1 的 reportSummaries/getBugReportForTask；`onViewBugReport(projectId:string,reportId:string):void` 为任务历史与 BUG 卡片共用入口。报告页接收既有 BugReportView，额外 `returnTo` 保存 BUG 项目/过滤和滚动位置；同问题多版本从该问题摘要中切换，不另做项目报告列表。

- [ ] 先写失败测试：A/B 两单只打开各自报告；无分析提示、排队提示并能查看任务；新任务运行时旧成功报告仍能打开；多目标代码项目选择切换正确；AI 删除后仍可读保存结果。
- [ ] 运行新 E2E 验证旧界面无逐问题按钮且历史按项目混合，确认失败点。
- [ ] 添加“打开分析报告”，根据选定分析项目筛选摘要；无结果时显示设计规定的中文状态，不跳入空报告。用面包屑和返回按钮承载二级页，保留来源列表位置；任务历史按 getBugReportForTask 进入同页；报告版本只列该问题的成功版本。
- [ ] 前端完全迁移后删除独立“BUG 报告历史”面板、无引用的 reports 响应字段及旧状态；运行 binding、queue、issue-log-download、account-bug-links E2E，目标存储单测和类型检查。
- [ ] 提交 `feat: open analysis reports from each bug and completed task`。

### A4：原因优先、默认折叠及证据原位展开

**Files:** Modify `pages/BugReportPage.tsx` 和 `apps/desktop/src/renderer/styles.css`；Create `components/BugEvidenceItem.tsx`、`tests/e2e/bug-report-reading.spec.ts`；必要时扩展组件测试。

**Interfaces:** `BugEvidenceItem({projectId,contextId,evidence}:{projectId:string;contextId:string;evidence:EvidenceRef})` 调用既有 readEvidence；组件以 `${report.id}:${evidence.id}` 为 key。每条拥有 open/loading/text/error 状态，报告切换或卸载后不采纳旧请求结果。内容状态用 `string|null`，空字符串是有效空片段，不用 truthy 判断代表“未读”。

- [ ] 写失败测试：原因和步骤初始可见；复现、事实、缺失信息、证据、上下文/模型用量均初始收起；展开两条证据后内容分别在其条目内，后续条目随布局向下。
- [ ] 在旧界面跑新测试，确认平铺和底部共享预览导致失败。
- [ ] 按设计重排报告，用 details/summary 或等价无障碍折叠控件懒渲染内容；支持证据 ID 入口定位并展开对应条目。局部错误、读取中、收起/重开和重试只影响当前证据；清理共享 excerpt 和页面底部预览。
- [ ] 以延迟响应验证先读 A 再切报告 B 不串内容；以错误与空文本验证当前项错误可见并可重试，另一项仍可读；运行 report-reading、report-binding E2E 及需求回归，类型检查和 lint。
- [ ] 提交 `feat: prioritize bug causes and expand evidence inline`。

## 子计划 A 交付门槛

- [ ] 不改真实数据库也可用隔离测试数据验证全部导航与报告场景。
- [ ] 用当前本机已有的真实成功报告只读验证从对应 BUG 打开、折叠及证据阅读；不得再次发送真实项目材料作为界面测试。
- [ ] 补充验收记录，确认删除旧组件/旧响应后无残留引用，再进入子计划 B。
