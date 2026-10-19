import { expect, it } from "vitest";
import { ScopePolicy, bindingFingerprint } from "./scope-policy";
import type {
  IssueConnection,
  RemoteIssue,
  IssueScope,
} from "../../../contracts/src/issues";
const connection: IssueConnection = {
  id: "c",
  name: "Jira",
  kind: "jira-cli",
  platform: "jira-dc",
  baseUrl: "https://jira.example",
  executable: "D:/jira.exe",
  configFile: "D:/jira.yml",
  bypassProxy: false,
  credentialRef: null,
};
const binding = {
  id: "b",
  platform: "jira-dc" as const,
  instanceUrl: connection.baseUrl,
  projectKey: "A",
  owner: "alice",
  connectionId: "c",
  issueTypeIds: ["1"],
};
const scope: IssueScope = {
  projectId: "local",
  enabled: true,
  binding,
  connection,
};
const issue: RemoteIssue = {
  remoteId: "1",
  key: "A-1",
  instanceUrl: connection.baseUrl,
  remoteProjectId: "A",
  ownerId: "alice",
  typeId: "1",
  title: "Bug",
  description: "repro",
  status: "Open",
  updatedAt: "2026-10-19",
  versions: [],
  comments: [],
  attachments: [],
  warnings: [],
};
it("asserts connection, instance, project, stable owner and issue type together", () => {
  expect(() => ScopePolicy.assert(scope, issue)).not.toThrow();
  for (const patch of [
    { remoteProjectId: "B" },
    { ownerId: "bob" },
    { typeId: "2" },
    { instanceUrl: "https://other.example" },
  ])
    expect(() => ScopePolicy.assert(scope, { ...issue, ...patch })).toThrow();
  expect(() =>
    ScopePolicy.assert({ ...scope, enabled: false }, issue),
  ).toThrow();
  expect(() =>
    ScopePolicy.assert(
      { ...scope, connection: { ...connection, id: "other" } },
      issue,
    ),
  ).toThrow();
  expect(bindingFingerprint(scope)).not.toEqual(
    bindingFingerprint({ ...scope, binding: { ...binding, owner: "bob" } }),
  );
});
