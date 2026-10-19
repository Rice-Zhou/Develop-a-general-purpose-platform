import { isAbsolute } from "node:path";
import { z } from "zod";
import type { IssueAdapter } from "../../../core/src/issues/ports";
import {
  ScopePolicy,
  instanceUrl,
} from "../../../core/src/issues/scope-policy";
import {
  RemoteIssueSchema,
  type IssueScope,
  type RemoteIssue,
} from "../../../contracts/src/issues";
import { AppError } from "../../../contracts/src/error";
import { runProcess, ProcessExitError } from "../process/run-process";
import { readJiraServer } from "./jira-config";
const id = z.union([z.string(), z.number()]).transform(String);
const record = z.object({
  id,
  key: z.string(),
  self: z.string(),
  fields: z.object({
    project: z.object({ key: z.string() }),
    assignee: z
      .object({ accountId: z.string().optional(), name: z.string().optional() })
      .nullable(),
    issuetype: z.object({ id }),
    summary: z.string(),
    description: z.unknown().optional(),
    status: z.object({ name: z.string() }),
    updated: z.string(),
    versions: z.array(z.object({ name: z.string() })).optional(),
    comment: z
      .object({
        total: z.number(),
        comments: z.array(z.object({ id, body: z.unknown() })),
      })
      .optional(),
    attachment: z
      .array(
        z.object({
          id,
          filename: z.string(),
          mimeType: z.string(),
          size: z.number(),
        }),
      )
      .optional(),
  }),
});
function prose(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  const pending: unknown[] = [value];
  const texts: string[] = [];
  let nodes = 0;
  while (pending.length) {
    if (++nodes > 20000)
      throw new AppError("ISSUE_TEXT_LIMIT", "Jira 富文本节点超过上限");
    const node = z
      .object({
        text: z.string().optional(),
        content: z.array(z.unknown()).optional(),
      })
      .parse(pending.pop());
    if (node.text) texts.push(node.text);
    if (node.content) pending.push(...node.content.slice().reverse());
  }
  return texts.join("\n");
}
export class JiraCliAdapter implements IssueAdapter {
  constructor(
    private readonly cwd: string,
    private readonly run: typeof runProcess = runProcess,
    private readonly readServer: typeof readJiraServer = readJiraServer,
  ) {}
  private args(scope: IssueScope): string[] {
    const c = scope.connection;
    if (
      c.kind !== "jira-cli" ||
      !isAbsolute(c.executable) ||
      !/\.exe$/i.test(c.executable) ||
      !isAbsolute(c.configFile)
    )
      throw new AppError(
        "ISSUE_CONNECTION_INVALID",
        "请选择 Jira 实际 exe 和独立 CLI 配置文件绝对路径",
      );
    return ["--config", c.configFile, "--project", scope.binding.projectKey];
  }
  private async page(
    scope: IssueScope,
    args: string[],
    signal: AbortSignal,
  ): Promise<unknown[]> {
    let output: string;
    try {
      output = await this.execute(scope, args, signal);
    } catch (error) {
      // jira-cli 1.7.0 exits 1 with this exact diagnostic for a successful empty query.
      if (
        error instanceof ProcessExitError &&
        error.exitCode === 1 &&
        error.diagnostic ===
          `✗ No result found for given query in project ${JSON.stringify(scope.binding.projectKey)}`
      )
        return [];
      throw error;
    }
    return z
      .union([
        z.array(z.unknown()),
        z.object({ issues: z.array(z.unknown()) }).transform((v) => v.issues),
      ])
      .parse(JSON.parse(output));
  }
  private async execute(
    scope: IssueScope,
    args: string[],
    signal: AbortSignal,
  ): Promise<string> {
    if (scope.connection.kind !== "jira-cli")
      throw new AppError("ISSUE_CONNECTION_INVALID", "不是 Jira CLI 连接");
    const configArgs = this.args(scope);
    if (
      instanceUrl(await this.readServer(scope.connection.configFile)) !==
      instanceUrl(scope.connection.baseUrl)
    )
      throw new AppError(
        "CLI_INSTANCE_MISMATCH",
        "Jira CLI 配置中的 server 与绑定实例不一致，未启动命令",
      );
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NO_COLOR: "1",
      CLICOLOR: "0",
    };
    delete env.JIRA_SERVER;
    delete env.JIRA_SERVER_URL;
    delete env.JIRA_CONFIG_FILE;
    if (scope.connection.bypassProxy)
      Object.assign(env, {
        HTTP_PROXY: "",
        HTTPS_PROXY: "",
        ALL_PROXY: "",
        http_proxy: "",
        https_proxy: "",
        all_proxy: "",
      });
    return this.run(scope.connection.executable, [...args, ...configArgs], {
      cwd: this.cwd,
      signal,
      env,
      timeoutMs: 30000,
      maxOutput: 8 * 1024 * 1024,
    });
  }
  async probe(scope: IssueScope, signal: AbortSignal): Promise<void> {
    const output = await this.execute(scope, ["serverinfo"], signal);
    const deployment = output
      .match(/Deployment Type:\s*([^\r\n]+)/)?.[1]
      ?.trim();
    const allowed =
      scope.connection.platform === "jira-cloud"
        ? ["Cloud"]
        : ["Server", "Data Center"];
    if (!deployment || !allowed.includes(deployment))
      throw new AppError(
        "CLI_DEPLOYMENT_MISMATCH",
        "Jira CLI 未返回匹配的部署类型，请检查配置和 CLI 版本",
      );
  }
  private normalize(scope: IssueScope, input: unknown): RemoteIssue {
    const raw = record.parse(input);
    const f = raw.fields;
    const self = new URL(raw.self);
    const marker = self.pathname.indexOf("/rest/api/");
    if (
      marker < 0 ||
      self.username ||
      self.password ||
      self.search ||
      self.hash
    )
      throw new AppError("CLI_INSTANCE_MISMATCH", "问题 self 地址不能验证实例");
    const base = self.origin + self.pathname.slice(0, marker);
    const comments = f.comment?.comments ?? [];
    const warnings = [
      "附件仅记录元信息，未下载或解析",
      "Jira 富文本转换为文本，图片和复杂排版不作为已解析证据",
    ];
    if (!f.comment || f.comment.total > comments.length)
      warnings.push("评论未完整读取，结论仅依据已取得的评论");
    const issue = RemoteIssueSchema.parse({
      remoteId: raw.id,
      key: raw.key,
      instanceUrl: base,
      remoteProjectId: f.project.key,
      ownerId:
        (scope.connection.platform === "jira-cloud"
          ? f.assignee?.accountId
          : f.assignee?.name) ?? "__UNASSIGNED__",
      typeId: f.issuetype.id,
      title: f.summary,
      description: prose(f.description),
      status: f.status.name,
      updatedAt: f.updated,
      versions: (f.versions ?? []).map((v) => v.name),
      comments: comments.map((c) => ({ id: c.id, text: prose(c.body) })),
      attachments: (f.attachment ?? []).map((a) => ({
        id: a.id,
        name: a.filename,
        mediaType: a.mimeType,
        size: a.size,
      })),
      warnings,
    });
    ScopePolicy.assert(scope, issue);
    return issue;
  }
  async list(scope: IssueScope, signal: AbortSignal): Promise<RemoteIssue[]> {
    await this.probe(scope, signal);
    const quote = (s: string) =>
      '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
    if (!scope.binding.issueTypeIds?.length)
      throw new AppError("ISSUE_NOT_CONFIGURED", "请配置 BUG 类型 ID");
    const jql = `project = ${quote(scope.binding.projectKey)} AND assignee = ${quote(scope.binding.owner)} AND issuetype in (${scope.binding.issueTypeIds.map(quote).join(",")})`;
    const result: RemoteIssue[] = [];
    const seen = new Set<string>();
    for (let page = 0; page < 100; page++) {
      const items = await this.page(
        scope,
        [
          "issue",
          "list",
          "--raw",
          "--jql",
          jql,
          "--paginate",
          `${result.length}:100`,
          "--order-by",
          "key",
          "--reverse",
        ],
        signal,
      );
      if (!items.length) return result;
      for (const item of items) {
        // list --raw is a CLI projection: fetch raw detail for stable identity and project fields.
        const key = z.object({ key: z.string() }).parse(item).key;
        if (seen.has(key))
          throw new AppError(
            "ISSUE_PAGINATION_INVALID",
            "Jira 分页重复，未发布部分列表",
          );
        const issue = await this.detail(scope, key, signal);
        if (seen.has("id:" + issue.remoteId))
          throw new AppError(
            "ISSUE_PAGINATION_INVALID",
            "Jira 分页重复，未发布部分列表",
          );
        seen.add(key);
        seen.add("id:" + issue.remoteId);
        result.push(issue);
        if (result.length > 5000)
          throw new AppError(
            "ISSUE_LIST_LIMIT",
            "范围内问题超过 5,000 条，请缩小配置范围",
          );
      }
    }
    throw new AppError(
      "ISSUE_LIST_LIMIT",
      "Jira 分页超过 100 页，未发布部分列表",
    );
  }
  async get(
    scope: IssueScope,
    key: string,
    signal: AbortSignal,
  ): Promise<RemoteIssue> {
    this.assertKey(scope, key);
    await this.probe(scope, signal);
    return this.detail(scope, key, signal);
  }
  private assertKey(scope: IssueScope, key: string): void {
    if (!/^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(key))
      throw new AppError("ISSUE_KEY_INVALID", "Jira 编号格式应为 PROJECT-123");
    if (key.slice(0, key.lastIndexOf("-")) !== scope.binding.projectKey)
      throw new AppError(
        "ISSUE_OUT_OF_SCOPE",
        "Jira 编号不属于配置项目，未启动读取命令",
      );
  }
  private async detail(
    scope: IssueScope,
    key: string,
    signal: AbortSignal,
  ): Promise<RemoteIssue> {
    this.assertKey(scope, key);
    const issue = this.normalize(
      scope,
      JSON.parse(
        await this.execute(
          scope,
          ["issue", "view", key, "--raw", "--comments", "500"],
          signal,
        ),
      ),
    );
    if (issue.key !== key)
      throw new AppError("ISSUE_KEY_MISMATCH", "返回了不同的问题编号");
    return issue;
  }
}
