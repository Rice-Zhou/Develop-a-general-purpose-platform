import { IssueService } from "./issue-service";
import type { Project } from "../../../contracts/src/models";
import type { IssueConnection, IssueSnapshot, RemoteIssue } from "../../../contracts/src/issues";

export function issueFixture() {
  const connections: IssueConnection[] = [
    { id: "j", kind: "jira-http", platform: "jira-dc", name: "Jira", baseUrl: "https://jira.example", username: "alice", credentialRef: null, bypassProxy: true },
    { id: "t", kind: "trinity", platform: "trinity", name: "Trinity", baseUrl: "https://trinity.example/trinity", credentialRef: null, bypassProxy: true },
  ];
  const project: Project = { id: "p", revision: 1, name: "Project", enabled: true, repositories: [], documents: [], aiProfileId: null, updatedAt: "now", issueBindings: connections.map(c => ({ id: c.id, connectionId: c.id, platform: c.platform, instanceUrl: c.baseUrl, projectKey: "A", owner: "alice", issueTypeIds: [c.id === "j" ? "1" : "BUG"] })) };
  const remote = (c: IssueConnection, n: number): RemoteIssue => ({ remoteId: String(n), key: `A-${n}`, instanceUrl: c.baseUrl, remoteProjectId: "A", ownerId: "alice", typeId: c.id === "j" ? "1" : "BUG", title: "Bug", description: "detail", status: c.id === "j" ? "分析中" : "assigned", updatedAt: "now", versions: [], comments: [], attachments: [], warnings: [], workitemId: `W-${n}` });
  const rows = new Map(connections.map(c => [c.id, [remote(c, 1)]]));
  const settings = new Map<string, unknown>([["issue-connections", connections]]);
  const batches = new Map<string, IssueSnapshot[]>();
  const failures = new Set<string>();
  const store = {
    getProject: () => project, listProjects: () => project.deletedAt ? [] : [project],
    getSetting: <T>(key: string) => structuredClone(settings.get(key) ?? null) as T | null,
    setSetting: (key: string, value: unknown) => { settings.set(key, structuredClone(value)); },
    issues: {
      replaceBatches: (values: {bindingId:string;snapshots:IssueSnapshot[]}[]) => { for(const value of values)batches.set(value.bindingId,value.snapshots); },
      save: () => {}, get: (_p: string, id: string) => [...batches.values()].flat().find(i => i.id === id)!,
      batch: (_p: string, b: string) => batches.get(b) ?? [],
      replaceBatch: (_p: string, b: string, _h: string, next: IssueSnapshot[]) => { batches.set(b, next); },
    },
  };
  const service = new IssueService(store, c => ({ list: async () => { if (failures.has(c.id)) throw new Error(`${c.name} offline`); return rows.get(c.id)!; }, get: async (_s, key) => rows.get(c.id)!.find(i => i.key === key)! }));
  return { store, service, rows, project, connections, failures, remote };
}
