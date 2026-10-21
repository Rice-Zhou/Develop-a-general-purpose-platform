import { it, expect, vi } from "vitest";
import { WorkGate } from "./work-gate";
import { IssueLogService } from "../issues/issue-log-service";
import type { IssueScope, RemoteIssue } from "../../../contracts/src/issues";
it("busy_freeze_restores_acceptance", () => {
  const gate = new WorkGate();
  expect(() => gate.freezeIfIdle(() => true)).toThrow();
  expect(() => gate.assertAccepting()).not.toThrow();
  gate.freezeIfIdle(() => false);
  expect(() => gate.assertAccepting()).toThrow();
  gate.release();
  expect(() => gate.assertAccepting()).not.toThrow();
});
it("late_attachment_discovery_rechecks_gate_before_creating_task", async () => {
  const gate = new WorkGate();
  const repository = {
    get: vi.fn(),
    latest: () => null,
    create: vi.fn(),
    update: vi.fn(),
  };
  let finish!: (value: []) => void;
  const service = new IssueLogService(
    repository,
    () => ({ listAttachments: () => new Promise<[]>((r) => (finish = r)) }),
    vi.fn(),
    () => {},
    vi.fn(),
    gate,
  );
  const pending = service.enqueue(
    {
      connection: { platform: "trinity", baseUrl: "https://t" },
      binding: { owner: "a" },
    } as IssueScope,
    { remoteId: "1", updatedAt: "now" } as RemoteIssue,
  );
  gate.freezeIfIdle(() => false);
  finish([]);
  await expect(pending).rejects.toMatchObject({ code: "UPDATE_IN_PROGRESS" });
  expect(repository.create).not.toHaveBeenCalled();
});
import {TaskService} from "../tasks/task-service";
import type {TaskRepository,RepositoryAdapter} from "../ports";
import type {ProjectService} from "../projects/project-service";
it("a frozen shared gate also prevents analysis enqueue",async()=>{const gate=new WorkGate();const saveTask=vi.fn();const store={listTasks:()=>[],saveTask} as unknown as TaskRepository;const tasks=new TaskService(store,{} as ProjectService,{} as RepositoryAdapter,undefined,gate);gate.freezeIfIdle(()=>false);await expect(tasks.enqueue("p","ANALYZE_BUG")).rejects.toMatchObject({code:"UPDATE_IN_PROGRESS"});expect(saveTask).not.toHaveBeenCalled();});
