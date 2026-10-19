import { expect, it } from "vitest";
import { IssueService } from "./issue-service";
import type {
  IssueConnection,
  IssueSnapshot,
  RemoteIssue,
} from "../../../contracts/src/issues";
import type { Project } from "../../../contracts/src/models";
const connection: IssueConnection = {
  id: "c",
  kind: "trinity",
  platform: "trinity",
  baseUrl: "https://trinity.example/trinity",
  name: "T",
  bypassProxy: false,
  credentialRef: null,
};
const project: Project = {
  id: "p",
  name: "P",
  enabled: true,
  revision: 1,
  repositories: [],
  documents: [],
  issueBindings: [
    {
      id: "b",
      platform: "trinity",
      instanceUrl: connection.baseUrl,
      connectionId: "c",
      projectKey: "A",
      owner: "alice",
      issueTypeIds: ["BUG"],
    },
  ],
  aiProfileId: null,
  updatedAt: "now",
};
const remote: RemoteIssue = {
  remoteId: "1",
  key: "BUG-1",
  instanceUrl: connection.baseUrl,
  remoteProjectId: "A",
  ownerId: "alice",
  typeId: "BUG",
  title: "Bug",
  description: "repro",
  status: "Open",
  updatedAt: "now",
  versions: [],
  comments: [],
  attachments: [],
  warnings: [],
};
it("publishes only whole valid batches and revalidates transfer and content before results", async () => {
  let current = { ...remote };
  const saved: IssueSnapshot[] = [];
  let batches = 0;
  const service = new IssueService(
    {
      getProject: () => project,
      listProjects: () => [project],
      getSetting: <T>() => [connection] as T,
      setSetting: () => {},
      issues: {
        save: (i) => {
          saved.push(i);
        },
        get: (_p, id) => {
          const i = saved.find((i) => i.id === id);
          if (!i) throw new Error("missing");
          return i;
        },
        replaceBatch: (_p, _b, _s, items) => {
          saved.push(...items);
          batches++;
        },
        batch: () => saved,
      },
    },
    () => ({ get: async () => current, list: async () => [current] }),
  );
  const [snapshot] = await service.refresh(
    "p",
    "b",
    undefined,
    new AbortController().signal,
  );
  expect(batches).toBe(1);
  current = { ...remote, ownerId: "bob" };
  await expect(
    service.refresh("p", "b", undefined, new AbortController().signal),
  ).rejects.toMatchObject({ code: "ISSUE_OUT_OF_SCOPE" });
  expect(batches).toBe(1);
  await expect(
    service.validateFresh(snapshot, new AbortController().signal),
  ).rejects.toMatchObject({ code: "ISSUE_OUT_OF_SCOPE" });
  current = { ...remote, description: "changed" };
  await expect(
    service.validateFresh(snapshot, new AbortController().signal),
  ).rejects.toMatchObject({ code: "ISSUE_CHANGED" });
});
