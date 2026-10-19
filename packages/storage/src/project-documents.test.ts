import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { DataStore } from "./database";
import { ProjectService } from "../../core/src/projects/project-service";
import type { Project } from "../../contracts/src/models";
import { parseRequest } from "../../contracts/src/ipc";

it("updates only a project's document bindings without requiring its unavailable Jira or repository", async () => {
  const dir = await mkdtemp(join(tmpdir(), "project-documents-"));
  const store = await DataStore.open(join(dir, "platform.db"));
  try {
    const source = join(dir, "requirements.docx");
    await writeFile(source, "source must survive unlinking");
    const document = { id: randomUUID(), kind: "docx" as const, locator: source, required: true };
    const project: Project = { id: randomUUID(), revision: 1, name: "A", enabled: true, updatedAt: "before", documents: [document], repositories: [{ id: randomUUID(), canonicalPath: join(dir, "unavailable-repository"), branch: "main", remoteName: "origin", role: "main", remoteUrlFingerprint: null }], aiProfileId: "existing-ai", issueBindings: [{ id: randomUUID(), connectionId: randomUUID(), platform: "jira-dc", instanceUrl: "https://unavailable.example", projectKey: "A", owner: "alice", issueTypeIds: ["1"] }] };
    const other = { ...project, id: randomUUID(), name: "B", repositories: [], issueBindings: [] };
    store.saveProject(project); store.saveProject(other);
    const service = new ProjectService(store);
    const updated = service.saveDocuments({ projectId: project.id, documents: [], expectedRevision: 1 });
    expect(updated).toMatchObject({ ...project, documents: [], revision: 2, updatedAt: expect.any(String) });
    expect(store.getProject(other.id)).toEqual(other);
    expect(await readFile(source, "utf8")).toBe("source must survive unlinking");
    expect(() => service.saveDocuments({ projectId: project.id, documents: [document], expectedRevision: 1 })).toThrow(/配置已被更新/);
    expect(store.getProject(project.id).documents).toEqual([]);
    const added = service.saveDocuments({ projectId: project.id, documents: [document, { id: randomUUID(), kind: "feishu", locator: "https://example.feishu.cn/docx/fixture", required: false }], expectedRevision: 2 });
    expect(added.documents).toHaveLength(2);
    expect(added.revision).toBe(3);
    store.deleteProject(project.id, 3);
    expect(() => service.saveDocuments({ projectId: project.id, documents: [], expectedRevision: 4 })).toThrow(/项目不存在/);
  } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});

it("requires revision and validates document changes at the IPC boundary", () => {
  const params = { projectId: randomUUID(), expectedRevision: 1, documents: [] };
  expect(parseRequest({ method: "saveProjectDocuments", params }).method).toBe("saveProjectDocuments");
  for (const patch of [{ expectedRevision: undefined }, { expectedRevision: 0 }, { name: "unauthorized change" }, { documents: [{ id: "d", kind: "docx", locator: "", required: true }] }]) {
    expect(() => parseRequest({ method: "saveProjectDocuments", params: { ...params, ...patch } })).toThrow();
  }
});
