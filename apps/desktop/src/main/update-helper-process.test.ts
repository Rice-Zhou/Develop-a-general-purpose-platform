import { EventEmitter } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { spawnDetached } from "./update-helper";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
afterEach(() => vi.unstubAllEnvs());

it("launches native installers without leaking the helper's Node mode into the new desktop client", async () => {
  const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
  vi.mocked(spawn).mockReturnValue(child as unknown as ChildProcess);
  const source = { ELECTRON_RUN_AS_NODE: "1", PLATFORM_DATA_DIR: "D:/analysis-data", PATH: "local-tools" };
  const pending = spawnDetached("verified-setup.exe", source);
  child.emit("spawn");
  await pending;

  expect(spawn).toHaveBeenLastCalledWith("verified-setup.exe", [], expect.objectContaining({
    detached: true, windowsHide: true, stdio: "ignore",
    env: { PLATFORM_DATA_DIR: "D:/analysis-data", PATH: "local-tools" },
  }));
  expect(source.ELECTRON_RUN_AS_NODE).toBe("1");
  expect(child.unref).toHaveBeenCalledOnce();
});

it("clears Node mode from the inherited CLI environment without changing the helper itself", async () => {
  vi.stubEnv("ELECTRON_RUN_AS_NODE", "1");
  const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
  vi.mocked(spawn).mockReturnValue(child as unknown as ChildProcess);
  const pending = spawnDetached("verified-setup.exe");
  child.emit("spawn");
  await pending;
  expect(vi.mocked(spawn).mock.calls.at(-1)?.[2]?.env?.ELECTRON_RUN_AS_NODE).toBeUndefined();
  expect(process.env.ELECTRON_RUN_AS_NODE).toBe("1");
});

it("surfaces process launch errors instead of marking a detached launch ready", async () => {
  const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
  vi.mocked(spawn).mockReturnValue(child as unknown as ChildProcess);
  const error = Object.assign(new Error("installer unavailable"), { code: "ENOENT" });
  const pending = spawnDetached("missing-setup.exe", {});
  child.emit("error", error);
  await expect(pending).rejects.toBe(error);
  expect(child.unref).not.toHaveBeenCalled();
});
