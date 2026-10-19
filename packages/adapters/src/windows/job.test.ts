import { expect, it } from "vitest";
import { spawn, execFileSync } from "node:child_process";
import { WindowsJob } from "./job";
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
};
it.skipIf(process.platform !== "win32")(
  "reclaims descendants after the owned service process crashes before allowing recovery",
  async () => {
    const job = new WindowsJob();
    const code = `process.stdin.once('data',()=>{const c=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});console.log(c.pid);setInterval(()=>{},1000);});`;
    const child = spawn(process.execPath, ["-e", code], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let descendant = 0;
    try {
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      job.assign(child.pid!);
      const announced = new Promise<number>((resolve) =>
        child.stdout.once("data", (data) =>
          resolve(Number(String(data).trim())),
        ),
      );
      child.stdin.write("start");
      descendant = await announced;
      expect(alive(descendant)).toBe(true);
      const exited = new Promise((resolve) => child.once("close", resolve));
      child.kill();
      await exited;
      await job.terminateAndClose();
      expect(alive(descendant)).toBe(false);
    } finally {
      await job.terminateAndClose();
      if (child.pid && alive(child.pid))
        execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
      if (descendant && alive(descendant)) process.kill(descendant, "SIGKILL");
    }
  },
);
