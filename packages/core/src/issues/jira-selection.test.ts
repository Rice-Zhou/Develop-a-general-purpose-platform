import { expect, it } from "vitest";
import { IssueService } from "./issue-service";
import type { IssueConnection, JiraCatalogue } from "../../../contracts/src/issues";
import type { Project } from "../../../contracts/src/models";

it("validates selected project, owner and named type against current login and rejects stale discovery", async () => {
  let connection: IssueConnection = { id: "c", kind: "jira-http", platform: "jira-dc", name: "Jira", baseUrl: "https://jira.example", username: "alice", credentialRef: null, bypassProxy: true };
  let change = false;
  const catalogue: JiraCatalogue = { owner: "alice", projects: [{ key: "A", name: "Alpha" }], issueTypes: [{ id: "1", name: "Bug" }], typeSource: "server" };
  const service = new IssueService({
    getProject: () => { throw new Error("discovery must not need an existing project"); },
    getSetting: <T>() => [connection] as T, setSetting: () => {},
    issues: { save: () => {}, get: () => { throw new Error("unused"); }, replaceBatch: () => {}, batch: () => [] },
  }, () => ({ get: async () => { throw new Error("unused"); }, list: async () => [], discover: async () => { if (change) connection = { ...connection, name: "changed" }; return catalogue; } }));
  const binding: Project["issueBindings"][number] = { id: "b", platform: "jira-dc", instanceUrl: connection.baseUrl, projectKey: "A", owner: "alice", connectionId: "c", issueTypeIds: ["1"] };
  await service.validateBindings([binding], new AbortController().signal);
  for (const patch of [{ owner: "bob" }, { projectKey: "B" }, { issueTypeIds: ["999"] }]) {
    await expect(service.validateBindings([{ ...binding, ...patch }], new AbortController().signal)).rejects.toMatchObject({ code: "JIRA_SELECTION_INVALID" });
  }
  change = true;
  await expect(service.catalogue("c", new AbortController().signal)).rejects.toMatchObject({ code: "PROJECT_CHANGED" });
});
