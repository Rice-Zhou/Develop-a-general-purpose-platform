# 需求审核、独立资料库与连接设置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成四项优化，保留历史数据并本地交付 1.0.2。

**Architecture:** 分三个顺序子计划，先统一资料与关联，再实现当前代码审核和人工决定，最后收拢连接设置及打包。审核复用现有任务队列、快照和报告，人工状态独立引用不可变报告。

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

1. 旧库升级途中失败、重复启动及旧客户端访问：A1 保证备份、原子迁移和版本拒绝。
2. 仅移动分类不应产生新需求，删除关联不能删除共享资源：A1/A2、B1 的内容版本测试。
3. AI 晚返回、重复提取、重复报告不能覆盖刚保存的误报：B1/B3 事务与幂等测试。
4. 脏工作区和审核中途修改文件不能触发代码更新或保存过期成功报告：B2/B3。
5. 项目切换晚返回、表单取消后凭据残留、进入设置自动探测：B4、C1/C2。

## 顺序与文件所有权

| 子计划 | 任务 | 主要责任 |
| --- | --- | --- |
| [A：独立资料库与数据迁移](2026-10-21-independent-resource-library.md) | A1—A2 | library 契约、唯一资源/关联存储、schema 11、分类及项目资料界面 |
| [B：当前代码审核与人工待办](2026-10-21-current-code-requirement-review.md) | B1—B4 | schema12 审核身份与决定、当前代码上下文、单任务审核、需求界面及错误归属 |
| [C：连接设置与交付](2026-10-21-connection-settings-delivery.md) | C1—C3 | BUG/AI 按需表单、原功能回归、1.0.2 本地发行 |

A1 统一修改共享 contracts/IPC/preload、storage migrations/database 的资源部分；B1/B3 在其基础上补充审核接口，不并行修改共享契约。B2/B3 负责 TaskService 与 Workbench 审核逻辑；C 只改连接展示生命周期。各任务修改后的目标测试、diff 检查和提交均在对应任务完成。

## 执行与验收

- [ ] 用户评审本索引与子计划，之后按 A1 → A2 → B1 → B2 → B3 → B4 → C1 → C2 → C3 直接实施，共 9 个任务。
- [ ] 使用明确 Node 运行时，避免 SQLite 原生模块 ABI 不一致：`C:/Users/uidq4225/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`。以下命令在根目录执行，`$node` 指该路径。
- [ ] 每项先运行目标失败测试，再实现并通过；迁移须同时测新库和已有 schema 10 库。
- [ ] 完成类型、lint、受影响桌面回归、发行打包及隔离安装启动验证；记录未能实际验证的外部服务边界。

## 计划自检

设计第 3 节映射 B1—B4，第 4 节映射 B4，第 5 节映射 A1—A2，第 6 节映射 C1—C2，第 7 节映射 A1/C3。人工任务不进入执行队列，分类元数据不影响内容身份；旧文档接口仅作规范资料投影。A1 独立交付 schema11，B1 再迁移 schema12，避免修改已运行的迁移；人工事件水位阻止晚报告覆盖刚完成的决定。所有跨任务方法及类型在下文定义；五类易漏问题均归属明确测试。没有扩展 BUG 分析、飞书通知或在线更新网络行为。
