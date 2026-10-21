import { it, expect } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readHandoffResult } from "./update-helper";
it("corrupt handoff records surface recoverable errors instead of preventing startup", async () => {
  const root = await mkdtemp(join(tmpdir(), "handoff-corrupt-"));
  try {
    const file = join(root, "result.json");
    for (const data of [
      "",
      '{"targetVersion":',
      JSON.stringify({ state: "unknown" }),
    ]) {
      await writeFile(file, data);
      await expect(readHandoffResult(file, "1.0.1")).resolves.toMatchObject({
        success: false,
        message: expect.stringContaining("交接记录"),
      });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
