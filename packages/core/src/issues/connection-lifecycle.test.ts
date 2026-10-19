import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { issueFixture } from "./issue-test-fixture";

describe("issue connection lifecycle", () => {
  it("keeps connections referenced by active or disabled projects", () => {
    const { service, project } = issueFixture();
    for (const enabled of [true, false]) {
      project.enabled = enabled;
      expect(() => service.deleteConnection("j")).toThrow(/仍被项目.*Project/);
      expect(service.connections()).toHaveLength(2);
    }
    project.issueBindings = project.issueBindings.filter(b => b.connectionId !== "j");
    service.deleteConnection("j");
    expect(service.connections().map(c => c.id)).toEqual(["t"]);
  });

  it("allows deletion after the referencing project is deleted", () => {
    const { service, project } = issueFixture();
    project.deletedAt = new Date().toISOString();
    service.deleteConnection("j");
    expect(service.connections().map(c => c.id)).toEqual(["t"]);
  });

  it("renews credentials without changing binding identity and rejects retargeting", () => {
    const { service, project, store, connections } = issueFixture();
    const id = randomUUID();
    const jira = { ...connections[0], id };
    store.setSetting("issue-connections", [jira, connections[1]]);
    project.issueBindings[0].connectionId = id;
    const draft = { kind: "jira-http", platform: "jira-dc", name: jira.name, baseUrl: jira.baseUrl, username: "alice", bypassProxy: true };
    const credentialRef = randomUUID();
    service.saveConnection({ id, credentialRef, draft: { ...draft, name: "Renamed" } });
    expect(service.connection(id)).toMatchObject({ id, credentialRef, name: "Renamed" });
    expect(project.issueBindings[0].connectionId).toBe(id);
    for (const change of [{ baseUrl: "https://another.example" }, { username: "bob" }, { kind: "trinity", platform: "trinity" }]) {
      expect(() => service.saveConnection({ id, credentialRef: null, draft: { ...draft, ...change } })).toThrow(/仍被项目/);
      expect(service.connection(id)).toMatchObject({ credentialRef, name: "Renamed" });
    }
    expect(service.connections()).toHaveLength(2);
  });
});
