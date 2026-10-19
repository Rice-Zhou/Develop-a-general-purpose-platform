import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { normalize } from "node:path";
import { AppError } from "../../../contracts/src/error";
import {
  ProjectDraftSchema,
  type ProjectDraft,
  type Project,
} from "../../../contracts/src/models";
import type { ProjectRepository } from "../ports";

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
      updatedAt: new Date().toISOString(),
    };
    this.store.saveProject(project, expectedRevision);
    return project;
  }
}
