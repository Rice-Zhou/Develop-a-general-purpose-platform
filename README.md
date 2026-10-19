# 本地研发辅助平台

本地桌面研发工作台。每个项目关联开发者自行下载的独立分析目录，平台检查并更新配置分支，保存固定代码版本和任务历史。

当前实现第一阶段。需求实现核对、Word/PDF/飞书解析、Jira/Trinity 接入、自动监控和 AI 分析尚未接入；界面会显示这些能力的实际状态。关联文档与 BUG 项目范围可先保存，当前不会读取远端或发起 AI 请求。

## 使用

当前支持 Windows x64。运行应用后：

1. 打开“项目管理”，添加参与的项目。
2. 配置独立代码分析目录、远端名称和分析分支。多个仓库可以关联到同一项目。
3. 确认目录是 Git 工作树根目录、当前分支正确且已设置对应 upstream。
4. 点击“更新并准备上下文”，在任务历史中查看状态、错误或固定提交。
5. 本地有修改、分支领先或分叉时，按错误提示自行处理，再重试。

平台只快进配置分支，不自动克隆、切换分支、stash、reset、清理文件或创建合并提交。不会构建项目、执行仓库脚本、推送代码或修改 BUG 单。

为了避免检出执行外部过滤器，第一阶段拒绝 Git LFS、检出过滤器和子模块；需要分析的子仓库可以单独配置为项目的另一个仓库。全局与系统 attributes 不参与检出，仓库内过滤器会被明确报告。

快照会在分析仓库写入 `refs/local-dev-platform/snapshots/<commit>` 本地引用，防止 Git 垃圾回收导致历史代码依据丢失。这些引用不推送远端，不改变工作分支。不要手动删除被历史任务引用的对象；本阶段不自动清理这些引用。

关闭窗口后进入托盘，明确退出才停止后台服务。异常中断任务显示为“运行中断”，重试会重新同步代码。任务成功仅表示代码上下文准备成功，不代表完成了需求或 BUG 分析。

宿主通过 Koffi 调用 Windows Job Object，在后台服务初始化前登记进程所有权。后台服务异常退出后，必须确认旧进程及其 Git 子进程退出才允许恢复；系统拒绝进程管理时显示错误并停止恢复。其他操作系统暂不提供发行包。

## 从源码运行

需要 Node 24 LTS、npm 11 及 Git。Windows 应用包运行时不需要 Node 或 Python，但代码同步仍需要 Git。

```powershell
npm ci
npm run dev
```

工程包含本地 npm 版本，用于避免宿主 npm 版本过旧影响 Forge。安装后也可使用：

```powershell
node node_modules/npm/bin/npm-cli.js run dev
```

受代理限制的开发环境应配置自己的 `HTTPS_PROXY` / `HTTP_PROXY`。Electron 下载可设置 `ELECTRON_GET_USE_PROXY=1`，Node 运行时支持时可使用 `--use-env-proxy`。不要把代理凭据或公司证书写入源码，也不要禁用 TLS 校验。

## 验证与打包

```powershell
npm test
npm run typecheck
npm run lint
npm run build
npm run test:e2e
npm run make
```

`build` 生成可运行的 Windows 应用目录，`make` 生成 ZIP 和安装程序，产物位于 `out/`。打包后的程序也可以通过设置 `PLATFORM_EXECUTABLE` 指向实际 exe 来运行相同 E2E 流程。

锁定的 better-sqlite3 13 与 Koffi 3 自带 Node-API 二进制；Forge 保留生产依赖并解包原生模块，不重新编译这两个模块。升级版本时必须重新运行打包后的 E2E。当前安装程序未配置代码签名。

测试使用临时目录和临时 Git 远端，不接触开发者真实项目。单测超时为 60 秒，桌面测试也有明确超时。Playwright 自动操作真实 Electron 窗口，不使用演示后端。

## 本地数据

开发模式和正式应用使用不同的 Electron userData 目录，可在设置页查看实际位置。数据库保存项目、任务、事件和快照元信息；代码内容依据固定提交从对应分析仓库读取。移动或删除分析仓库会影响历史代码读取。

设置中的“备份本地数据库”使用 SQLite 一致备份能力。备份不包含代码仓库、原始文档或可移植登录凭据。恢复到其他电脑时需要重新关联路径。

高级用法：`PLATFORM_DATA_DIR` 可指定独立应用数据目录，适用于隔离测试或独立配置空间。不要将它设置为代码仓库或资料原文目录。

## 工程结构

| 目录 | 职责 |
| --- | --- |
| `apps/desktop` | Electron 宿主、受限 preload、后台服务与 React 界面 |
| `packages/contracts` | IPC schema、领域类型、结构化错误 |
| `packages/core` | 项目用例、代码访问策略、任务调度及接口 |
| `packages/adapters` | Git 检查、安全同步、固定提交读取、进程树取消 |
| `packages/storage` | SQLite、项目存储、内容快照与凭据存储边界 |
| `packages/testkit` | 临时仓库测试工具 |
| `tests/e2e` | 真实桌面流程验证 |

外部接入仍需提供 Jira 部署类型、Trinity 实例接口、飞书访问方式以及实际模型和本机 AI 工具配置；这些条件不会由模拟适配器代替。
