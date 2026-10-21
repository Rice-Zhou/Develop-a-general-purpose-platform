# GitHub 版本与迭代管理

仓库：[Rice-Zhou/Develop-a-general-purpose-platform](https://github.com/Rice-Zhou/Develop-a-general-purpose-platform)。本地开发目录保持 `D:/development/Develop-a-general-purpose-platform`。

## 代码历史

- `main` 保存稳定交付代码和版本文档。
- 当前开发分支为 `develop/issue-milestone`；后续具体需求可建立 `feature/简短名称` 或 `fix/简短名称` 分支。
- 每项完成且验证通过的改动提交到 Git，在提交信息说明具体行为变化；重要设计与验收记录随代码提交。
- 推送开发分支后，通过 Pull Request 审查并合入 `main`，不覆盖已有远端历史。

首次上传保留本地完整 Git 提交历史，而不是将目录压缩包作为源码。源码不包含 `node_modules`、`out`、本机数据库、日志、凭据或临时联调目录。

## 版本记录

每次迭代将用户可见变更加入根目录 [CHANGELOG.md](../CHANGELOG.md) 的“未发布”。正式打包时同步 `package.json` 和 `package-lock.json` 根版本；完成测试后，把变更移入对应版本节并记录验证结果。

`v1.0.1` 指向实际打包的源代码提交 `ee3ccc3`，后续维护文档的提交可以继续位于 `main`。Git 标签用于固定版本代码；GitHub Release 用于分发安装包和更新清单。只推送代码或标签不会让客户端发现可安装更新。

后续版本流程：

1. 从最新 `main` 建立开发分支，修改、测试并更新变更记录。
2. 推送分支，创建 Pull Request，合入 `main`。
3. 在正确版本代码上完成打包，核对安装器与 `platform-update.json` 的版本、大小及 SHA-256。
4. 在通过验证的提交上创建带注释的 `v主.次.修订` 标签，推送该标签。
5. 在 GitHub 创建正式 Release，上传同一次构建的安装包和清单，填写版本说明。详见 [公开 Release 发布说明](公开GitHubRelease发布说明.md)。

正式 Release 是独立的发布操作。客户端读取公开仓库最新正式 Release，不接受草稿、预发布或只存在标签的版本。
