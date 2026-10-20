import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { DataStore } from "./database";
import { ProjectService } from "../../core/src/projects/project-service";
import type { Project } from "../../contracts/src/models";

it("configures resources separately and associates existing projects without reading repositories", async () => {
  const dir = await mkdtemp(join(tmpdir(), "resource-links-")); const store = await DataStore.open(join(dir, "app.db"));
  try {
    const project: Project = { id: randomUUID(), revision: 1, name: "A", enabled: true, updatedAt: "before", repositories: [{ id: "r", canonicalPath: join(dir, "unavailable"), branch: "main", remoteName: "origin", role: "main", remoteUrlFingerprint: null }], documents: [], issueBindings: [], aiProfileId: null };
    store.saveProject(project);
    const resource = store.saveDocumentResource({ name: "需求 B", kind: "docx", locator: join(dir, "B.docx"), required: true });
    expect(store.getProject(project.id).documents).toEqual([]);
    const service = new ProjectService(store);
    const linked = service.saveLinks({ projectId: project.id, expectedRevision: 1, documents: [{ id: resource.id, kind: resource.kind, locator: resource.locator, required: resource.required }], issueBindings: [], aiProfileId: null });
    expect(linked.documents[0].locator).toBe(resource.locator);
    expect(() => store.deleteDocumentResource(resource.id, resource.revision)).toThrow(/关联/);
    const edited = store.saveDocumentResource({ id: resource.id, name: resource.name, kind: resource.kind, required: resource.required, locator: join(dir, "B-v2.docx") }, resource.revision);
    expect(store.getProject(project.id).documents[0].locator).toBe(edited.locator);
    expect(store.getProject(project.id).revision).toBeGreaterThan(linked.revision);
    expect(() => service.saveLinks({ projectId: project.id, expectedRevision: linked.revision, documents: [], issueBindings: [], aiProfileId: null })).toThrow(/配置已被更新/);
    const current = store.getProject(project.id);
    service.saveLinks({ projectId: project.id, expectedRevision: current.revision, documents: [], issueBindings: [], aiProfileId: null });
    expect(store.documentResources()).toHaveLength(1);
    store.deleteDocumentResource(edited.id, edited.revision);
    expect(store.documentResources()).toEqual([]);
  } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});

it("inherits the default AI for old and new projects while keeping explicit overrides", async () => {
  const dir = await mkdtemp(join(tmpdir(), "default-ai-")); const store = await DataStore.open(join(dir, "app.db"));
  try {
    const first = randomUUID(), second = randomUUID();
    store.setSetting("profiles", [first, second].map(id => ({ id, kind: "api", name: id, baseUrl: "https://model.example", model: "fixture", outboundEnabled: true, credentialRef: null })));
    const base: Project = { id: randomUUID(), revision: 1, name: "A", enabled: true, updatedAt: "before", repositories: [], documents: [], issueBindings: [], aiProfileId: null };
    store.saveProject(base); store.saveProject({ ...base, id: "override", aiProfileId: first });
    store.setDefaultAIProfile(first);
    expect(store.getProject(base.id)).toMatchObject({ aiProfileId: first, usesDefaultAI: true });
    const oldRevision = store.getProject(base.id).revision;
    store.setDefaultAIProfile(second);
    expect(store.getProject(base.id)).toMatchObject({ aiProfileId: second, usesDefaultAI: true });
    expect(store.getProject(base.id).revision).toBe(oldRevision + 1);
    expect(store.getProject("override").aiProfileId).toBe(first);
    expect(() => store.setDefaultAIProfile(randomUUID())).toThrow(/不存在/);
  } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});
