import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { normalize } from "node:path";
import { AppError } from "../../../contracts/src/error";
import {
  ProjectDraftSchema,
  ProjectDocumentsUpdateSchema,
  ProjectLinksUpdateSchema,
  TrinityProjectMappingSchema,
  type ProjectDraft,
  type Project,
} from "../../../contracts/src/models";
import type { ProjectRepository } from "../ports";
import { instanceUrl } from "../issues/scope-policy";

export async function canonicalizeRepositoryPath(
  path: string,
): Promise<string> {
  const canonical = normalize(await realpath(path));
  if (!(await stat(canonical)).isDirectory())
    throw new AppError("INVALID_DIRECTORY", "分析路径必须是目录");
  return canonical;
}
export class ProjectService {
  constructor(private readonly store: ProjectRepository) {}
  list(): Project[] {
    return this.store.listProjects();
  }
  get(id: string): Project {
    return this.store.getProject(id);
  }
  delete(id: string, expectedRevision: number): void {
    this.store.deleteProject(id, expectedRevision);
  }
  saveDocuments(input: { projectId: string; documents: Project["documents"]; expectedRevision: number }): Project {
    const update = ProjectDocumentsUpdateSchema.parse(input);
    const previous = this.store.getProject(update.projectId);
    const project = { ...previous, documents: update.documents, revision: previous.revision + 1, updatedAt: new Date().toISOString() };
    this.store.saveProject(project, update.expectedRevision);
    return this.store.getProject(project.id);
  }
  saveLinks(input: { projectId: string; documents: Project["documents"]; issueBindings: Project["issueBindings"]; aiProfileId: string | null; usesDefaultAI?: boolean; trinityProjects?: Project["trinityProjects"]; expectedRevision: number }): Project {
    const update = ProjectLinksUpdateSchema.parse(input);
    const resources = this.store.documentResources();
    if (update.documents.some(d => !resources.some(r => r.id === d.id && r.kind === d.kind && r.locator === d.locator))) throw new AppError("DOCUMENT_RESOURCE_CHANGED", "需求文档资源不存在或已修改，请重新选择");
    const previous = this.store.getProject(update.projectId);
    const project = { ...previous, documents: update.documents, issueBindings: update.issueBindings, aiProfileId: update.aiProfileId, trinityProjects: update.trinityProjects ?? previous.trinityProjects, usesDefaultAI: update.usesDefaultAI ?? !update.aiProfileId, revision: previous.revision + 1, updatedAt: new Date().toISOString() };
    this.store.saveProject(project, update.expectedRevision);
    return this.store.getProject(project.id);
  }
  associateTrinityProject(projectId: string, expectedRevision: number, input: NonNullable<Project["trinityProjects"]>[number]): Project {
    const parsed=TrinityProjectMappingSchema.parse(input);
    const mapping={...parsed,instanceUrl:instanceUrl(parsed.instanceUrl)};
    const previous=this.store.getProject(projectId);
    if(!previous.enabled)throw new AppError("PROJECT_DISABLED","代码项目已停用，请启用后关联");
    if(!previous.issueBindings.some(b=>b.platform==="trinity"&&b.scopeMode==="account"&&instanceUrl(b.instanceUrl)===mapping.instanceUrl))throw new AppError("ISSUE_OUT_OF_SCOPE","代码项目未关联此 Trinity 账号实例，请刷新后重试");
    const mappings=previous.trinityProjects??[];
    const trinityProjects=[...mappings.filter(m=>instanceUrl(m.instanceUrl)!==mapping.instanceUrl||m.projectId!==mapping.projectId),mapping];
    if(trinityProjects.length>100)throw new AppError("TRINITY_MAPPING_LIMIT","每个代码项目最多关联 100 个 Trinity 项目");
    this.store.saveProject({...previous,trinityProjects,revision:previous.revision+1,updatedAt:new Date().toISOString()},expectedRevision);
    return this.store.getProject(projectId);
  }
  async save(input: ProjectDraft, expectedRevision?: number): Promise<Project> {
    const draft = ProjectDraftSchema.parse(input);
    const previous = draft.id ? this.store.getProject(draft.id) : undefined;
    const repositories = await Promise.all(
      draft.repositories.map(async (repo) => {
        const canonicalPath = await canonicalizeRepositoryPath(repo.path);
        const old = previous?.repositories.find(
          (item) =>
            item.canonicalPath === canonicalPath &&
            item.remoteName === repo.remoteName &&
            item.branch === repo.branch,
        );
        return {
          id: old?.id ?? randomUUID(),
          canonicalPath,
          remoteName: repo.remoteName,
          branch: repo.branch,
          role: repo.role,
          remoteUrlFingerprint: old?.remoteUrlFingerprint ?? null,
        };
      }),
    );
    const project: Project = {
      id: previous?.id ?? randomUUID(),
      name: draft.name,
      enabled: draft.enabled,
      revision: (previous?.revision ?? 0) + 1,
      repositories,
      documents: draft.documents,
      issueBindings: draft.issueBindings,
      aiProfileId: draft.aiProfileId,
      usesDefaultAI: draft.usesDefaultAI ?? (!draft.aiProfileId && previous?.aiProfileId === null ? previous.usesDefaultAI : undefined),
      trinityProjects: draft.trinityProjects ?? previous?.trinityProjects,
      updatedAt: new Date().toISOString(),
    };
    this.store.saveProject(project, expectedRevision);
    return this.store.getProject(project.id);
  }
}
