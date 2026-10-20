# Trinity 账号问题读取真实联调验收（0.7.4）

## 根因及真实证据

2026-10-20，使用用户明确授权的临时会话，仅对原配置实例发起只读查询。0.7.3 请求发送 `mode=assignToMe` 和 `userId`，但目标接口并未据此限制负责人，返回全平台 150427 条问题。分页结构本身有效，旧代码的 `total <= 10000` 校验将其误归类为“响应契约不符或登录已失效”。

读取 `/quality/bugRedux/getSearchSelectEnums` 确认，负责人字段为 `assigneeId`，条件类型为 `SINGLEUSER`，字段类型为 `STRING`，支持 `EQ`。向 `/quality/bugRedux/getBugsByMultiProjects` 发送明确的服务端条件后，返回当前账号 2 条问题，所有负责人均与验证过的 UID 相同。

## 实现

1. 账号列表仅使用一处负责人条件：`bugReduxCustomConditionsQueryBO.conditions` 中 `assigneeId / SINGLEUSER / STRING / EQ / [当前 UID]`。移除未生效的 mode、userId 及重复空筛选参数，不增加客户端全量扫描或静默过滤。
2. 列表跨所有远端项目，代码项目映射只限制预分析，不限制该账号的问题展示。列表每条记录仍通过详情复核负责人、来源、类型及问题号；不放宽归属校验。
3. 当前详情契约使用 condition、activities、expectedResult、actualResult，以及可用的 causeAnalysis、solvedScheme 组成有来源标签的描述，使用 modifyTime 作为修改标识。HTML 只提取文本并删除 script/style，保留段落和换行；不执行远端内容。
4. 历史 description/updateTime 详情契约保留显式兼容。带有当前结构标记的响应必须满足当前字段要求，缺少真实时间戳会失败，不补当前时间或假描述。
5. 业务码、字段契约、读取数量限制和分页异常分别报告。5002／50012 等会话错误要求重新登录；其他业务错误只显示业务码；字段错误只显示路径，未保存错误正文。
6. 超过 10000 条明确报告查询过宽并停止，不读取详情或发布部分列表。重复页、错页、总数变化及不完整分页仍失败。

## 验证

- 新增 6 项契约回归测试，先复现失败，再验证服务端筛选、当前详情字段、错误分类、转派拦截和缺失时间戳拦截。
- 相关单元测试 55 项通过，5 项依赖原生 Jira CLI 环境的测试跳过；TypeScript 与 ESLint 通过。
- 打包桌面回归 5 项全部通过：当前结构化详情及跨项目账号继承、Jira CLI 预分析及转派拒绝、双平台故障隔离和定时提醒、延迟探测不覆盖输入、账号登录及失败后重试。未重跑完整端到端套件。
- 直接加载本次生产 TrinityAdapter（运行时磁盘缓存关闭），经其真实网络实现完成 userinfo → 个人列表 → 全部详情 → 规范化及归属校验，结果为 2 条，均有负责人、修改时间、问题号和非空描述。
- 真实联调未修改问题、未发送消息、未调用 AI 模型。会话和业务响应只在临时内存中使用，完成后重置临时运行环境；未将令牌、个人标识或问题正文写入代码、文档及磁盘响应。

评论、附件、图片及远端问题版本仍没有完整读取，继续在材料 warnings 中说明。此次真实验收不包含 AI 模型端到端分析。

## 发行

`out/releases/0.7.4/`：

- 便携启动：`本地研发辅助平台-win32-x64/LocalDevPlatform.exe`
- 安装程序：`make/squirrel.windows/x64/LocalDevPlatformSetup.exe`
- 便携 ZIP：`make/zip/win32/x64/本地研发辅助平台-win32-x64-0.7.4.zip`

从托盘退出旧版后启动新版，BUG 工作台点击“刷新问题单”。无需修改代码项目或 Trinity 项目映射。

ZIP 与便携目录的 83 个文件逐项 SHA-256 一致。

- app.asar：`0d7ef628c012302f9b9173039389556e3f2de8f183af4ce9cb0f4fe7b74d2ddd`
- 安装程序：`833208918d8e13b5c62980c955b0930e341cd83d824b87e1d77c60705cece7d1`
- ZIP：`5fd133b99393a318ea64e422d1499cb5702cc8073c9adfc3f72b0d56726b853d`
