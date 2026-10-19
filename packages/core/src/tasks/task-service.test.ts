import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DataStore } from "../../../storage/src/database";
import { ProjectService } from "../projects/project-service";
import { TaskService } from "./task-service";
import { GitRepositoryAdapter } from "../../../adapters/src/git/repository";
import { gitFixture, git } from "../../../testkit/src/git-fixture";
import type { Task } from "../../../contracts/src/models";
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "local-platform-tasks-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const f = await gitFixture();
  cleanup.push(f.dispose);
  const store = await DataStore.open(join(root, "app.db"));
  cleanup.push(async () => store.close());
  const projects = new ProjectService(store);
  const project = await projects.save({
    name: "A",
    enabled: true,
    repositories: [
      {
        path: f.analysis,
        remoteName: "origin",
        branch: "main",
        role: "主仓库",
      },
    ],
    documents: [],
    issueBindings: [],
    aiProfileId: null,
  });
  const tasks = new TaskService(store, projects, new GitRepositoryAdapter());
  cleanup.push(() => tasks.shutdown());
  return { root, f, store, projects, project, tasks };
}
async function settled(tasks: TaskService, id: string): Promise<Task> {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const task = tasks.get(id);
    if (
      ["SUCCEEDED", "WAITING_INPUT", "FAILED", "CANCELLED"].includes(
        task.status,
      )
    )
      return task;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    `Task did not settle within 30 seconds: ${JSON.stringify(tasks.get(id))}`,
  );
}
describe("persistent preparation tasks", () => {
  it("commits a context and task success together and isolates project history", async () => {
    const { tasks, project, store } = await setup();
    const task = await tasks.enqueue(project.id, "PREPARE_CONTEXT");
    const done = await settled(tasks, task.id);
    expect(done.status).toBe("SUCCEEDED");
    expect(done.contextSnapshotId).toBeTruthy();
    expect(store.getContext(done.contextSnapshotId!).projectId).toBe(
      project.id,
    );
    expect(tasks.list("another-project")).toEqual([]);
    expect(store.taskEvents(task.id).map((e) => e.sequence)).toEqual([
      1, 2, 3, 4,
    ]);
  });
  it("blocks dirty worktrees and preserves the user edit", async () => {
    const { tasks, project, f } = await setup();
    await writeFile(join(f.analysis, "feature.txt"), "keep");
    const done = await settled(
      tasks,
      (await tasks.enqueue(project.id, "PREPARE_CONTEXT")).id,
    );
    expect(done.status).toBe("WAITING_INPUT");
    expect(done.error?.code).toBe("WORKTREE_DIRTY");
    expect(done.contextSnapshotId).toBeNull();
  });
  it("keeps successful earlier repository updates but publishes no partial context", async () => {
    const { tasks, project, f, projects, root } = await setup();
    const second = await gitFixture();
    cleanup.push(second.dispose);
    const updated = await f.publish("new");
    const configured = await projects.save(
      {
        id: project.id,
        name: "A",
        enabled: true,
        repositories: [
          {
            path: f.analysis,
            remoteName: "origin",
            branch: "main",
            role: "主仓库",
          },
          {
            path: second.analysis,
            remoteName: "origin",
            branch: "main",
            role: "第二仓库",
          },
        ],
        documents: [],
        issueBindings: [],
        aiProfileId: null,
      },
      project.revision,
    );
    git(
      second.analysis,
      "remote",
      "set-url",
      "origin",
      join(root, "does-not-exist"),
    );
    const done = await settled(
      tasks,
      (await tasks.enqueue(configured.id, "PREPARE_CONTEXT")).id,
    );
    expect(done.status).toBe("FAILED");
    expect(done.contextSnapshotId).toBeNull();
    expect(git(f.analysis, "rev-parse", "HEAD")).toBe(updated);
  });
  it("cancels a queued task and retries a failed attempt as a new task", async () => {
    const { tasks, project, f } = await setup();
    await writeFile(join(f.analysis, "feature.txt"), "dirty");
    const first = await tasks.enqueue(project.id, "PREPARE_CONTEXT");
    const second = await tasks.enqueue(project.id, "PREPARE_CONTEXT");
    await tasks.cancel(second.id);
    expect(tasks.get(second.id).status).toBe("CANCELLED");
    await settled(tasks, first.id);
    git(f.analysis, "restore", "feature.txt");
    const retried = await tasks.retry(first.id);
    expect(retried.attempt).toBe(2);
    expect((await settled(tasks, retried.id)).status).toBe("SUCCEEDED");
  });
  it("marks persisted running work interrupted on restart rather than successful", async () => {
    const { tasks, project, store } = await setup();
    await tasks.shutdown();
    const timestamp = new Date().toISOString();
    store.saveTask({
      id: "interrupted-task",
      projectId: project.id,
      projectName: "A",
      kind: "PREPARE_CONTEXT",
      status: "PREPARING",
      attempt: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      error: null,
      contextSnapshotId: null,
    });
    const restarted = new TaskService(
      store,
      new ProjectService(store),
      new GitRepositoryAdapter(),
    );
    cleanup.push(() => restarted.shutdown());
    expect(restarted.get("interrupted-task").status).toBe("INTERRUPTED");
  });
  it("refuses source preparation while a project is disabled", async () => {
    const { tasks, project, projects, f } = await setup();
    await projects.save(
      {
        id: project.id,
        name: "A",
        enabled: false,
        repositories: [
          {
            path: f.analysis,
            remoteName: "origin",
            branch: "main",
            role: "主仓库",
          },
        ],
        documents: [],
        issueBindings: [],
        aiProfileId: null,
      },
      project.revision,
    );
    await expect(
      tasks.enqueue(project.id, "PREPARE_CONTEXT"),
    ).rejects.toMatchObject({ code: "PROJECT_DISABLED" });
  });
});
