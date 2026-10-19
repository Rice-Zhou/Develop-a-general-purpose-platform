import { expect, it } from "vitest";
import { spawn, execFileSync } from "node:child_process";
import { terminateProcessTree } from "./process-tree";
function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}
it("terminates a task-owned parent and its descendant before reporting cancellation", async () => {
  const code = `const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true}); console.log(child.pid); setInterval(()=>{},1000);`;
  const child = spawn(process.execPath, ["-e", code], {
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  let descendant = 0;
  try {
    descendant = await new Promise<number>((resolve, reject) => {
      child.stdout.once("data", (bytes) =>
        resolve(Number(bytes.toString().trim())),
      );
      child.once("error", reject);
    });
    expect(alive(descendant)).toBe(true);
    await terminateProcessTree(child.pid!);
    for (let i = 0; i < 50 && (alive(child.pid!) || alive(descendant)); i++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    expect(alive(child.pid!)).toBe(false);
    expect(alive(descendant)).toBe(false);
  } finally {
    if (child.pid && alive(child.pid)) {
      if (process.platform === "win32")
        execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
      else process.kill(-child.pid, "SIGKILL");
    }
    if (descendant && alive(descendant)) process.kill(descendant, "SIGKILL");
  }
});
