import { expect, it } from "vitest";
import { IssueService } from "./issue-service";
import type {
  IssueConnection,
  IssueSnapshot,
  RemoteIssue,
} from "../../../contracts/src/issues";
import type { Project, Task } from "../../../contracts/src/models";

it("indexes only the three requested Jira statuses and rejects completed single reads and analysis", async () => {
  const connection: IssueConnection = {
    id: "c", kind: "jira-cli", platform: "jira-dc", name: "Jira",
    baseUrl: "https://jira.example", executable: "D:/jira.exe",
    configFile: "D:/jira.yml", bypassProxy: true, credentialRef: null,
  };
  const project: Project = {
    id: "p", revision: 1, name: "P", enabled: true,
    repositories: [], documents: [], aiProfileId: null, updatedAt: "now",
    issueBindings: [{
      id: "b", platform: "jira-dc", instanceUrl: connection.baseUrl,
      projectKey: "A", owner: "alice", connectionId: "c", issueTypeIds: ["1"],
    }],
  };
  const issue = (status: string, index: number): RemoteIssue => ({
    remoteId: String(index), key: `A-${index}`, instanceUrl: connection.baseUrl,
    remoteProjectId: "A", ownerId: "alice", typeId: "1", title: status,
    description: "fixture", status, updatedAt: "now", versions: [],
    comments: [], attachments: [], warnings: [],
  });
  const records = ["修复中", "分析中", "分配中", "已完成", "已关闭"].map(issue);
  let listed = records;
  let current = records[0];
  let batch: IssueSnapshot[] = [];
  let publications = 0;
  const service = new IssueService({
    getProject: () => project,
    getSetting: <T>() => [connection] as T,
    setSetting: () => {},
    issues: {
      save: () => { publications++; },
      get: () => batch[0],
      replaceBatch: (_p, _b, _h, next) => {
        batch = next;
        publications++;
      },
      batch: () => batch,
    },
  }, () => ({ list: async () => listed, get: async () => current }));
  const signal = new AbortController().signal;
  const indexed = await service.refresh("p", "b", undefined, signal);
  expect(indexed.map((i) => i.status)).toEqual(["修复中", "分析中", "分配中"]);
  // Simulate an existing cache from the previous release.
  batch.push({ ...indexed[0], id: "old-completed", status: "已完成" });
  expect(service.workspace("p").issues.map((i) => i.status)).toEqual(["修复中", "分析中", "分配中"]);
  current = { ...records[0], status: "已完成" };
  await expect(service.refresh("p", "b", current.key, signal)).rejects.toMatchObject({ code: "ISSUE_STATUS_INACTIVE" });
  await expect(service.prepare({ projectId: "p", issueSnapshotId: indexed[0].id } as Task, signal)).rejects.toMatchObject({ code: "ISSUE_STATUS_INACTIVE" });
  await expect(service.validateFresh(indexed[0], signal)).rejects.toMatchObject({ code: "ISSUE_STATUS_INACTIVE" });
  expect(publications).toBe(1);
  listed = records.slice(3);
  expect(await service.refresh("p", "b", undefined, signal)).toEqual([]);
  expect(service.workspace("p").issues).toEqual([]);
  expect(publications).toBe(2);
});
