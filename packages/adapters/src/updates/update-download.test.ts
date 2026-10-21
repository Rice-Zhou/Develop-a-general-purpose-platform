import { describe, it, expect } from "vitest";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { downloadVerified } from "./update-download";
import type { UpdateOffer } from "../../../contracts/src/updates";
const bytes = Buffer.from("installer"),
  sha256 = createHash("sha256").update(bytes).digest("hex");
const offer: UpdateOffer = {
  id: "1:hash",
  version: "1.0.2",
  notes: "",
  releaseUrl: "https://github.com/release",
  assetUrl:
    "https://github.com/Rice-Zhou/Develop-a-general-purpose-platform/releases/download/v1.0.2/LocalDevPlatformSetup.exe",
  manifest: {
    schemaVersion: 1,
    version: "1.0.2",
    platform: "win32",
    arch: "x64",
    assetName: "LocalDevPlatformSetup.exe",
    size: bytes.length,
    sha256,
  },
};
describe("verified download", () => {
  it.each(["ok", "hash", "size", "length", "cancel"])(
    "handles %s without promoting invalid bytes",
    async (mode) => {
      const root = await mkdtemp(join(tmpdir(), "verified-update-"));
      try {
        const controller = new AbortController();
        if (mode === "cancel") controller.abort();
        const modified = {
          ...offer,
          manifest: {
            ...offer.manifest,
            ...(mode === "hash" ? { sha256: "0".repeat(64) } : {}),
            ...(mode === "size" ? { size: bytes.length + 1 } : {}),
          },
        };
        const transport = async () =>
          new Response(bytes, {
            headers: mode === "length" ? { "content-length": "900" } : {},
          });
        const run = downloadVerified(
          modified,
          root,
          controller.signal,
          () => {},
          transport as typeof fetch,
        );
        if (mode === "ok") {
          expect((await run).sha256).toBe(sha256);
          expect(
            (await readdir(root, { recursive: true })).some((p) =>
              p.endsWith(".part"),
            ),
          ).toBe(false);
        } else {
          await expect(run).rejects.toThrow();
          expect(
            (await readdir(root, { recursive: true })).some(
              (p) => p.endsWith(".exe") || p.endsWith(".part"),
            ),
          ).toBe(false);
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
import {vi} from "vitest";
it("cleans interrupted streams and inactivity timeouts",async()=>{
 for(const mode of ["interrupted","idle"]){const root=await mkdtemp(join(tmpdir(),"update-stream-"));let started=false;vi.useFakeTimers({toFake:["setTimeout","clearTimeout"]});
 try{const transport=async(_input:unknown,init?:RequestInit)=>{started=true;return new Response(new ReadableStream<Uint8Array>({start(controller){if(mode==="interrupted"){controller.enqueue(bytes.subarray(0,2));controller.error(new Error("network interrupted"));}else init?.signal?.addEventListener("abort",()=>controller.error(init.signal?.reason),{once:true});}}));};const pending=downloadVerified(offer,root,new AbortController().signal,()=>{},transport as typeof fetch);const rejected=expect(pending).rejects.toThrow();if(mode==="idle"){while(!started)await new Promise<void>(r=>setImmediate(r));await vi.advanceTimersByTimeAsync(30001);}await rejected;expect((await readdir(root,{recursive:true})).some(p=>p.endsWith(".exe")||p.endsWith(".part"))).toBe(false);}finally{vi.useRealTimers();await rm(root,{recursive:true,force:true});}}
});
