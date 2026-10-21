# 公开 GitHub Release 发布说明

更新仓库：https://github.com/Rice-Zhou/Develop-a-general-purpose-platform 。

1.0.2 曾于 2026-10-21 发布，随后因真实历史数据迁移失败撤回草稿，附件保留，禁止将其视为通过验收的升级包。源码和迁移修复已记录，完整自动升级暂未通过；详见 [1.0.2 发布联调验收](1.0.2GitHubRelease发布与在线更新联调验收.md)。后续修复版应使用新版本，保留 v1.0.2 标签与原始产物的一致性。

1.0.1 已于 2026-10-21 正式发布：[v1.0.1 Release](https://github.com/Rice-Zhou/Develop-a-general-purpose-platform/releases/tag/v1.0.1)。安装包及清单均已上传并核对 GitHub SHA-256。实际安装和当前网络限制见 [发布联调验收](1.0.1GitHubRelease发布与在线更新联调验收.md)。

后续发布者在获得明确授权后，在该仓库创建正式 Release，标签按 `v主.次.修订` 递增。关闭草稿、预发布标记，并上传同一次 make 生成的两个必需附件：

- `LocalDevPlatformSetup.exe`
- `platform-update.json`

当前两文件位于 `out/releases/1.0.2/make/squirrel.windows/x64/`。清单由 Forge postMake 从最终安装包生成，含版本、win32/x64、精确字节数、SHA-256；请勿手改或混用旧包。可选上传便携 ZIP、RELEASES、nupkg，本客户端在线更新只使用完整 Setup.exe。

运行 `npm run make` 默认输出当前版本目录。指定 PLATFORM_BUILD_DIR 时，最终版本目录须以当前版本号命名。客户端无需 GitHub Token；发布权限只用于发布者上传。

客户端直连官方 HTTPS Release API；只接受本仓库附件地址和官方附件 CDN，逐跳检查跳转、限制下载体积与超时，验大小与 SHA-256。403 会显示访问受限/限流错误；latest 404 会进一步确认仓库能否访问，不将仓库不可见误报为最新。

0.9.3 首次需手动启动或安装 1.0.1。便携版选择在线更新后转为安装版，用户数据目录仍为原 Electron userData。安装前禁止新任务入队并确认无活动任务，随后关闭后台服务；有任务时请等待或自行取消。若交接失败且后台已停止，使用“重启客户端恢复”。启动安装器不等于安装成功；下次启动版本达到目标才确认成功。

1.0.1 已经用户授权执行真实安装，安装退出码 0，原项目、连接和报告保留。旧安装版到新安装版的跨版本覆盖升级、客户端自动下载至安装交接的完整闭环仍需在可直连附件的网络中验证。
