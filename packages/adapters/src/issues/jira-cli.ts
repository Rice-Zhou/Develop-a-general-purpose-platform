import { isAbsolute } from "node:path";
import { z } from "zod";
import type { IssueAdapter } from "../../../core/src/issues/ports";
import { instanceUrl } from "../../../core/src/issues/scope-policy";
import {
  type IssueScope,
  type RemoteIssue,
} from "../../../contracts/src/issues";
import { AppError } from "../../../contracts/src/error";
import { runProcess, ProcessExitError } from "../process/run-process";
import { readJiraServer } from "./jira-config";
import { normalizeJira, jiraQuery, assertJiraKey } from "./jira-format";
import { directEnvironment } from "../network/policy";
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
      ...directEnvironment(),
      NO_COLOR: "1",
      CLICOLOR: "0",
    };
    delete env.JIRA_SERVER;
    delete env.JIRA_SERVER_URL;
    delete env.JIRA_CONFIG_FILE;
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
  async list(scope: IssueScope, signal: AbortSignal): Promise<RemoteIssue[]> {
    await this.probe(scope, signal);
    const jql = jiraQuery(scope);
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
    assertJiraKey(scope, key);
    await this.probe(scope, signal);
    return this.detail(scope, key, signal);
  }
  private async detail(
    scope: IssueScope,
    key: string,
    signal: AbortSignal,
  ): Promise<RemoteIssue> {
    assertJiraKey(scope, key);
    const issue = normalizeJira(
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
