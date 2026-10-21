import {captureWorktree} from "../../../adapters/src/git/worktree-snapshot";
import {SnapshotStore} from "../../../storage/src/snapshot-store";
import {AppError} from "../../../contracts/src/error";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DataStore } from "../../../storage/src/database";
import { ProjectService } from "../projects/project-service";
import { TaskService, type TaskRuntime } from "./task-service";
import { GitRepositoryAdapter } from "../../../adapters/src/git/repository";
import { gitFixture, git } from "../../../testkit/src/git-fixture";
import type { Task } from "../../../contracts/src/models";
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
});
async function setup(runtime?: TaskRuntime) {
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
  const tasks = new TaskService(
    store,
    projects,
    new GitRepositoryAdapter(),
    {configurationHash:()=>"fixture",captureDocuments:async()=>({documents:[],sourceGaps:[]}),indexContext:async()=>[],analyze:async()=>{throw new Error("fixture analysis unavailable");},captureCurrentCode:(b,signal)=>captureWorktree(b,new SnapshotStore(join(root,"content")),signal),...runtime},
  );
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
  it.each(["project", "profile"])("rejects %s changes during capture before invoking analysis", async (change) => {
    let configuration = "original-connection";
    const analyze = vi.fn(async () => { throw new Error("must not send materials"); });
    const f = await setup({
      configurationHash: () => configuration,
      captureDocuments: async () => {
        if (change === "project") f.store.saveProject({ ...f.project, revision: f.project.revision + 1, aiProfileId: "new-connection" }, f.project.revision);
        else configuration = "changed-endpoint";
        return { documents: [], sourceGaps: [] };
      },
      indexContext: async () => [],
      analyze,
    } as TaskRuntime);
    const queued = await f.tasks.enqueue(f.project.id, "EXTRACT_REQUIREMENTS");
    const done = await settled(f.tasks, queued.id);
    expect(done.status).toBe("WAITING_INPUT");
    expect(done.error?.code).toBe("PROJECT_CHANGED");
    expect(analyze).not.toHaveBeenCalled();
  });
  it("binds queued work to its project revision before any repository access", async () => {
    const f = await setup();
    const pending = f.tasks.enqueue(f.project.id, "PREPARE_CONTEXT");
    f.store.saveProject({ ...f.project, revision: f.project.revision + 1 }, f.project.revision);
    const queued = await pending;
    const done = await settled(f.tasks, queued.id);
    expect(done.status).toBe("WAITING_INPUT");
    expect(done.error?.code).toBe("PROJECT_CHANGED");
    expect(f.store.taskEvents(queued.id).some(e => e.stage === "GIT_SYNC")).toBe(false);
  });
  it("publishes document captures and index coverage in the same context", async () => {
    const f = await setup({
      configurationHash: () => "fixture",
      captureDocuments: async () => ({
        documents: [
          {
            id: "doc",
            bindingId: "d",
            contentHash: "0".repeat(64),
            kind: "pdf",
          },
        ],
        sourceGaps: [],
      }),
      indexContext: async () => ["partial index"],
      analyze: async () => {
        throw new Error("not an analysis task");
      },
    });
    const done = await settled(
      f.tasks,
      (await f.tasks.enqueue(f.project.id, "PREPARE_CONTEXT")).id,
    );
    expect(done.status).toBe("SUCCEEDED");
    const context = f.store.getContext(done.contextSnapshotId!);
    expect(context.documents).toHaveLength(1);
    expect(context.limitations).toContain("partial index");
  });
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
      1, 2, 3, 4, 5, 6,
    ]);
  });
  it.each(["PREPARE_CONTEXT","EXTRACT_REQUIREMENTS","CHECK_REQUIREMENTS"] as const)("captures dirty current code without Git updates for %s", async(kind)=>{
    const {tasks,project,f,store}=await setup();const head=git(f.analysis,"rev-parse","HEAD");
    await writeFile(join(f.analysis,"feature.txt"),"keep");await writeFile(join(f.analysis,"new.txt"),"new uncommitted");
    const done=await settled(tasks,(await tasks.enqueue(project.id,kind)).id);
    expect(store.taskEvents(done.id).some(e=>e.stage==="GIT_SYNC")).toBe(false);
    expect(store.taskEvents(done.id).some(e=>e.stage==="CODE_SNAPSHOT")).toBe(true);
    if(kind==="PREPARE_CONTEXT"){expect(done.status).toBe("SUCCEEDED");const r=store.getContext(done.contextSnapshotId!).repositories[0];expect(r.kind).toBe("worktree");expect(r.files.map(x=>x.path)).toContain("new.txt");}
    expect(git(f.analysis,"rev-parse","HEAD")).toBe(head);expect(git(f.analysis,"status","--porcelain")).toContain("new.txt");
  });
  it("captures multiple current repositories even when their remotes are unavailable", async () => {
    const { tasks, project, f, projects, root } = await setup();
    const second = await gitFixture();
    cleanup.push(second.dispose);
    const before=git(f.analysis,"rev-parse","HEAD");
    await f.publish("new");
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
    expect(done.status).toBe("SUCCEEDED");
    expect(done.contextSnapshotId).toBeTruthy();
    expect(git(f.analysis, "rev-parse", "HEAD")).toBe(before);
  });
  it("cancels a queued task and retries a failed attempt as a new task", async () => {
    let fail=true;
    const {tasks,project,f}=await setup({captureCurrentCode:async(b,signal)=>{if(fail)throw new AppError("WORKTREE_CHANGED","changed");return captureWorktree(b,new SnapshotStore(join(f.root,"content")),signal);}} as TaskRuntime);
    await writeFile(join(f.analysis,"feature.txt"),"dirty");
    const first = await tasks.enqueue(project.id, "PREPARE_CONTEXT");
    const second = await tasks.enqueue(project.id, "PREPARE_CONTEXT");
    await tasks.cancel(second.id);
    expect(tasks.get(second.id).status).toBe("CANCELLED");
    await settled(tasks, first.id);
    fail=false;
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
