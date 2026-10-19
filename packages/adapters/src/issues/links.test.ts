import { expect, it } from "vitest";
import { jiraIssueUrl } from "./jira-format";
import type { IssueScope, RemoteIssue } from "../../../contracts/src/issues";
const scope: IssueScope = {
  projectId: "p",
  enabled: true,
  binding: {
    id: "b",
    connectionId: "c",
    platform: "jira-dc",
    instanceUrl: "https://jira.example/context",
    projectKey: "A",
    owner: "alice",
    issueTypeIds: ["1"],
  },
  connection: {
    id: "c",
    kind: "jira-cli",
    name: "Jira",
    platform: "jira-dc",
    baseUrl: "https://jira.example/context",
    executable: "D:/jira.exe",
    configFile: "D:/jira.yml",
    bypassProxy: true,
    credentialRef: null,
  },
};
const issue: RemoteIssue = {
  remoteId: "1",
  key: "A-1",
  instanceUrl: "https://jira.example/context",
  remoteProjectId: "A",
  ownerId: "alice",
  typeId: "1",
  title: "bug",
  description: "https://evil.example",
  status: "Open",
  updatedAt: "2026-10-19",
  versions: [],
  comments: [],
  attachments: [],
  warnings: [],
};
it("builds only validated project issue links and never follows issue content URLs", () => {
  expect(jiraIssueUrl(scope, issue)).toBe(
    "https://jira.example/context/browse/A-1",
  );
  for (const patch of [
    { key: "B-1" },
    { key: "javascript:alert(1)" },
    { instanceUrl: "https://evil.example" },
    { ownerId: "bob" },
  ])
    expect(() => jiraIssueUrl(scope, { ...issue, ...patch })).toThrow();
});
