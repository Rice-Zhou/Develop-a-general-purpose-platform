import { expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Workbench } from "./workbench";
import type { AIProfile } from "../../../../packages/contracts/src/analysis";
import { runProcess } from "../../../../packages/adapters/src/process/run-process";
vi.mock("../../../../packages/adapters/src/process/run-process", async (original) => ({
  ...await original<typeof import("../../../../packages/adapters/src/process/run-process")>(),
  runProcess: vi.fn(async () => JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: '{"result":1}' } })),
}));
vi.mock("../../../../packages/adapters/src/network/ai-endpoint", async (original) => ({
  ...await original<typeof import("../../../../packages/adapters/src/network/ai-endpoint")>(),
  resolveAIConnection: vi.fn(async () => ({})),
}));
const profile: AIProfile = Object.freeze({ kind: "codex", id: "saved", name: "Saved subscription", executable: "D:/npm/old/codex.exe", model: "gpt-6.1-sol", credentialRef: null, outboundEnabled: true, proxyUrl: "127.0.0.1:7897" });
it("resolves saved old Codex executables at execution time without mutating the saved connection", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-transport-"));
  const discoverCodex = vi.fn(async () => ({ selected: { executable: "D:/desktop/latest/codex.exe", version: "0.163.0-alpha.10.2" }, models: [{ id: "gpt-6.1-sol" }] }));
  const runtime = Object.assign(Object.create(Workbench.prototype), { dataPath: root, discoverCodex }) as Workbench;
  try {
    vi.mocked(runProcess).mockClear();
    const transport = await runtime["transport"](profile);
    expect(discoverCodex).toHaveBeenCalledWith(profile.proxyUrl,undefined);
    expect(transport.identity).toMatchObject({ profileId: profile.id, name: profile.name, configuredModel: profile.model, location: "D:/desktop/latest/codex.exe" });
    expect(await transport.complete([], [], new AbortController().signal)).toEqual({ content: "1" });
    expect(runProcess).toHaveBeenCalledWith("D:/desktop/latest/codex.exe", expect.any(Array), expect.any(Object));
    expect(profile.executable).toBe("D:/npm/old/codex.exe");
    const denied = await runtime["transport"]({ ...profile, outboundEnabled: false });
    await expect(denied.complete([], [], new AbortController().signal)).rejects.toMatchObject({ code: "OUTBOUND_NOT_APPROVED" });
    expect(runProcess).toHaveBeenCalledTimes(1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
it("rejects an unavailable configured model rather than choosing another model or the saved executable", async () => {
  const discoverCodex = vi.fn(async () => ({ selected: { executable: "D:/latest/codex.exe" }, models: [{ id: "another-model" }] }));
  const runtime = Object.assign(Object.create(Workbench.prototype), { dataPath: process.cwd(), discoverCodex }) as Workbench;
  vi.mocked(runProcess).mockClear();
  await expect(runtime["transport"](profile)).rejects.toMatchObject({ code: "CODEX_MODEL_UNAVAILABLE" });
  expect(runProcess).not.toHaveBeenCalled();
});
it("propagates discovery failures without executing the saved old CLI", async () => {
  const failure = new Error("latest CLI could not be verified");
  const runtime = Object.assign(Object.create(Workbench.prototype), { discoverCodex: vi.fn(async () => { throw failure; }) }) as Workbench;
  vi.mocked(runProcess).mockClear();
  await expect(runtime["transport"](profile)).rejects.toBe(failure);
  expect(runProcess).not.toHaveBeenCalled();
});
it("passes task cancellation into CLI discovery so cancelling cannot wait for its independent timeout",async()=>{
 const root=await mkdtemp(join(tmpdir(),"codex-cancel-"));const controller=new AbortController();const discoverCodex=vi.fn(async(_proxy?:string,signal?:AbortSignal)=>{expect(signal).toBe(controller.signal);return {selected:{executable:"D:/latest/codex.exe"},models:[{id:"gpt-6.1-sol"}]};});const runtime=Object.assign(Object.create(Workbench.prototype),{dataPath:root,discoverCodex}) as Workbench;
 try{await runtime["transport"](profile,undefined,controller.signal);}finally{await rm(root,{recursive:true,force:true});}
});
