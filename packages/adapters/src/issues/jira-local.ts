import { isAbsolute } from "node:path";
import { existsSync } from "node:fs";
import type { LocalJiraConfiguration } from "../../../contracts/src/issues";
import { AppError, errorData } from "../../../contracts/src/error";
import { instanceUrl } from "../../../core/src/issues/scope-policy";
import { runProcess } from "../process/run-process";
import { directEnvironment } from "../network/policy";
import { readJiraServer } from "./jira-config";
export async function inspectLocalJira(
  executable: string,
  configFile: string,
  cwd: string,
): Promise<LocalJiraConfiguration> {
  const result: LocalJiraConfiguration = {
    available: false,
    executable,
    configFile,
    baseUrl: "",
    username: "",
    platform: null,
    detail:
      "未发现可用的本地 Jira CLI 登录配置，请使用账号登录或指定已有 CLI。",
  };
  if (
    !isAbsolute(executable) ||
    !/\.exe$/i.test(executable) ||
    !isAbsolute(configFile) ||
    !existsSync(executable) ||
    !existsSync(configFile)
  )
    return result;
  try {
    result.baseUrl = instanceUrl(await readJiraServer(configFile));
    const env = directEnvironment();
    delete env.JIRA_SERVER;
    delete env.JIRA_SERVER_URL;
    delete env.JIRA_CONFIG_FILE;
    const run = (command: string) =>
      runProcess(executable, [command, "--config", configFile], {
        cwd,
        env,
        signal: AbortSignal.timeout(30000),
        maxOutput: 1024 * 1024,
      });
    const info = await run("serverinfo");
    const deployment = info.match(/Deployment Type:\s*([^\r\n]+)/)?.[1]?.trim();
    if (deployment === "Cloud") result.platform = "jira-cloud";
    else if (deployment === "Server" || deployment === "Data Center")
      result.platform = "jira-dc";
    else
      throw new AppError(
        "CLI_DEPLOYMENT_MISMATCH",
        "本地 CLI 未返回可识别的部署类型",
      );
    result.username = (await run("me")).trim();
    if (
      !result.username ||
      result.username.length > 2048 ||
      /[\r\n]/.test(result.username)
    )
      throw new AppError("ISSUE_LOGIN_FAILED", "本地 CLI 未返回有效登录账号");
    result.available = true;
    result.detail = "已读取本地 Jira CLI 配置，选择项目时将验证真实登录身份。";
  } catch (error) {
    result.available = false;
    result.username = "";
    result.detail = `本地 Jira CLI 检查失败：${errorData(error).message}`;
  }
  return result;
}
