# Trinity 登录 Token 与身份校验修复（0.7.2）

## 现象与根因

登录时出现 `TRINITY_IDENTITY_REQUIRED`，连接未保存。排查发现两处问题：

1. 平台把登录返回的 token 去前缀后重新拼接 `Bearer `，而 Trinity 公开前端会把登录返回的 token 原样写入 `X-Token`。服务端返回不带前缀的 token 时，原实现会改变认证值。
2. 身份校验把业务返回码、UID、API 版本、灰度字段合在一次校验中，任何字段不符都会误报 UID 缺失，掩盖会话失效。

2026-10-20 通过本地网络直连核对 [Trinity 登录站点](https://trinity.desaysv.com/) 的公开前端：`app~80ca7e3d.eb256cdb.js` 保存登录返回的 `data.token`；`app~6a2c624d.5e1d3d7f.js` 直接从 Cookie 读取该值并设置 `X-Token`。未携带 token 请求 `/trinity/sys/user/userinfo` 返回业务码 `5002`。这些检查未使用账号密码。

## 修改范围

- 登录后的身份验证及所有 Trinity BUG 请求均原样传递 token。服务端返回自带 `Bearer ` 的值也原样保留，不猜测或自动重试另一种认证方式。
- `trinity-session.ts` 统一解析身份响应的业务状态及协议字段，供登录和 BUG 适配器共用。
- 非成功业务状态使用 `ISSUE_LOGIN_FAILED` 并显示业务码；真正缺少有效 UID 使用 `TRINITY_IDENTITY_REQUIRED`；缺少 API 版本或灰度配置使用 `TRINITY_PROTOCOL_INVALID`。
- 仍要求服务端返回可验证的 UID，不用输入的登录名替代。验证失败不保存连接，不输出 token、密码或响应正文。
- 网络继续直连，数据库结构不变。

## 验证范围

- 新增回归测试复现旧版：无前缀 token 被改写后服务端返回 `5002`，旧逻辑误报 UID 缺失。
- 分别验证无前缀及自带前缀 token，在身份验证和 BUG 详情请求中保持不变。
- 验证会话失败、UID 空白、协议缺失分开报错；错误不包含服务端私有正文。
- 相关单元测试：37 项通过、5 项依赖原生 Jira CLI 环境的测试跳过；类型检查及 ESLint 通过。

打包桌面回归 5 项全部通过：跨项目 Trinity 账号关联及预分析映射、Jira／Trinity 问题预分析、双来源汇总及定时提醒、延迟 Jira 探测不覆盖 Trinity 输入、身份验证失败不保存连接及随后重试登录成功。未重新运行完整端到端套件。

没有使用真实企业账号登录；真实账号需要用户用新版重新登录确认。桌面测试使用本地模拟服务和隔离数据目录，不发送真实飞书消息。

## 发行

版本 `0.7.2`，目录 `out/releases/0.7.2/`。启动前从托盘退出旧版，重新输入 Trinity 账号密码登录即可。

ZIP 与便携目录的 83 个文件逐项 SHA-256 一致。

- app.asar：`8ef894e5b137d4cd21706376aed35eedf6606c0e8e10be911eacda98f0206c25`
- 安装程序：`6cbb223a7a5e670d5a3e963ad1ab039161618e4f567e9baef5148df0a8e4ea53`
- ZIP：`157b9450e10af0c644cf993701092f8faed9cf8aa40e2f8c1111f41ba3b53554`
