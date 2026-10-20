import type { Project } from "../../../contracts/src/models";
import type { IssueConnection } from "../../../contracts/src/issues";
export function trinityAccountBinding(account: Extract<IssueConnection,{kind:"trinity"}>): Project["issueBindings"][number] {
 return {id:`trinity-account-${account.id}`,connectionId:account.id,platform:"trinity",instanceUrl:account.baseUrl,projectKey:"*",owner:account.accountId ?? "待重新登录",issueTypeIds:["BUG"],scopeMode:"account"};
}
export function resolveIssueBindings(project: Project, connections: IssueConnection[]): Project["issueBindings"] {
 const account = connections.find(c => c.kind === "trinity");
 const bindings = project.issueBindings.filter(b => b.platform !== "trinity" || !account).map(b => {
  const connection = connections.find(c => c.id === b.connectionId);
  if (!connection || connection.kind === "trinity" || !connection.jiraProject) return b;
  return {...b, platform:connection.platform, instanceUrl:connection.baseUrl, projectKey:connection.jiraProject.key, owner:connection.jiraProject.owner, issueTypeIds:connection.jiraProject.issueTypeIds};
 });
 if (account?.kind === "trinity") bindings.push(trinityAccountBinding(account));
 return bindings;
}
