# 任务导航、BUG 报告阅读与 GitHub 在线更新 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成已认可的五项体验优化，并交付可安装的 1.0.1 客户端。

**Architecture:** 分为两个可独立验证的子计划。A 复用现有任务、报告和证据数据；B 新增主进程更新服务，复用直连网络、Squirrel 安装包和服务关闭流程。两个子计划完成后统一打包验证，不在同一发行目录中交叉运行测试与打包。

**Tech Stack:** Electron 44.9.0、React 19.3.1、TypeScript 5.9.3、SQLite/better-sqlite3、Zod、Undici、Vitest、Playwright、Electron Forge/Squirrel。

**Spec:** [已认可设计](../specs/2026-10-21-task-bug-reading-release-update-design.md)。

## Global Constraints

- 根目录固定 `D:/development/Develop-a-general-purpose-platform`；现有 0.9.3 已有真实成功报告，必须保留可读。
- 版本目标 1.0.1；单元测试超时默认 60000ms，不为无关失败扩大超时。
- 当前会话由同一执行者直接实施，不额外要求用户重选执行方式，不新建聊天或另一个开发路径。
- 默认更新仓库 `https://github.com/Rice-Zhou/Develop-a-general-purpose-platform`，公开，无 Token。
- 网络直连，不复用 AI 代理；无用户选择不下载、不安装；活动任务不强制终止。
- 不发布 GitHub Release，不上传仓库内容；本次生成可发布素材和说明。

## Review Focus

1. 报告使用分析前重新读取的快照，不能用任务原始输入快照 ID 绑定（A1）。
2. Trinity 一单对应多个代码项目、来源配置变化和历史报告阅读隔离（A1/A3）。
3. 证据读取晚返回、组件卸载及空片段不能串报告或伪装加载成功（A4）。
4. GitHub 403/404、预发布、同版本、损坏包与取消不能伪装已是最新或可安装（B1/B2）。
5. 安装空闲检查后恰好有新分析或日志入队，以及安装器启动失败（B3/B4）。

## 执行顺序与评审

- [ ] 用户评审本索引和两个子计划，确认覆盖已认可设计。
- [ ] 执行 [子计划 A：任务与报告阅读](2026-10-21-task-bug-reading.md)，依次完成 A1—A4。
- [ ] 执行 [子计划 B：GitHub 在线更新](2026-10-21-github-client-update.md)，依次完成 B1—B5。
- [ ] 每任务完成目标测试并检查 diff，再提交该任务；出现新的数据边界或接口变更时先更新计划。
- [ ] 汇总验收并保存提交，交付启动文件、安装器、ZIP、更新清单及验证边界。

执行前读取仓库约定及两个子计划。使用明确的本机 Node 运行时，避免系统 Node 与原生 SQLite ABI 不匹配：
`C:/Users/uidq4225/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`。

本文和两个子计划目前只描述实施步骤；设计已批准，本计划需评审通过后开始产品修改。

## 计划自检记录

已对照设计逐项检查：A1—A4 覆盖前四项体验，B1—B5 覆盖更新来源、一次提示、选择下载、完整性检查、安全交接和发行验收。报告关联使用报告实际快照；任务和日志共用 WorkGate；证据局部状态与更新状态分别由唯一所有者维护。接口名称、类型及消费任务已核对，不引入第二份报告/任务表。真实 API 403、当前安装路径与版本升级未实测的边界要求分别记录，不以本地协议测试冒充真实发布或安装验证。
